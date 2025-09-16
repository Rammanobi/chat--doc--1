import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';
import { defineSecret } from 'firebase-functions/params';

if (!admin.apps.length) {
  admin.initializeApp();
}

// Access Gemini API key via Functions secret
const geminiApiKey = defineSecret('GEMINI_API_KEY');

// Split text into ~N-word chunks with overlap for better recall
function chunkTextByWords(text: string, targetWords = 900, overlapWords = 120): string[] {
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  if (words.length === 0) return chunks;
  const step = Math.max(1, targetWords - Math.max(0, overlapWords));
  for (let start = 0; start < words.length; start += step) {
    const end = Math.min(words.length, start + targetWords);
    const slice = words.slice(start, end).join(' ');
    if (slice.trim()) chunks.push(slice);
    if (end === words.length) break;
  }
  return chunks;
}

export const processUploadedDocument = onObjectFinalized(
  { region: 'us-central1', secrets: [geminiApiKey] },
  async (event) => {
  const object = event.data;
  try {
    const bucketName = object.bucket;
    const filePath = object.name || '';
    const contentType = object.contentType || '';
    const metadata = (object.metadata || {}) as Record<string, string>;

    logger.info('processUploadedDocument received', { filePath, contentType, metadata });

    // docId from custom metadata preferred; fallback to filename without extension
    let docId = metadata.docId || metadata.docid || '';
    if (!docId) {
      const fileName = path.basename(filePath);
      docId = fileName.replace(path.extname(fileName), '');
    }

    const bucket = admin.storage().bucket(bucketName);
    const tmpDir = os.tmpdir();
    const tmpFilePath = path.join(tmpDir, path.basename(filePath));

    // Mark as processing immediately so UI shows progress
    const db = admin.firestore();
    const docRef = db.collection('documents').doc(docId);
    const baseFileName = path.basename(filePath);
    const initialData: any = {
      status: 'processing',
      filePath,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (metadata.userId) initialData.userId = metadata.userId;
    if (metadata.sessionId) initialData.sessionId = metadata.sessionId;
    if (baseFileName) initialData.fileName = baseFileName;
    await docRef.set(initialData, { merge: true });

    await bucket.file(filePath).download({ destination: tmpFilePath });
    logger.info('Downloaded file', { tmpFilePath });

    const ext = path.extname(tmpFilePath).toLowerCase();
    let extractedText = '';
    let statusMessage = '';

    try {
      if (ext === '.pdf') {
        const data = fs.readFileSync(tmpFilePath);
        const pdfData = await pdfParse(data);
        extractedText = pdfData?.text || '';
      } else if (ext === '.docx') {
        const result = await mammoth.extractRawText({ path: tmpFilePath });
        extractedText = result?.value || '';
      } else if (ext === '.doc') {
        // .doc (legacy Word) is not supported in this runtime
        statusMessage = 'Unsupported file type .doc. Please upload PDF, DOCX, or TXT.';
        extractedText = '';
      } else if (ext === '.txt') {
        extractedText = fs.readFileSync(tmpFilePath, 'utf8');
      } else {
        // Unknown type: do not attempt risky parsing; mark as unsupported
        statusMessage = `Unsupported file type ${ext || '(none)'}. Please upload PDF, DOCX, or TXT.`;
        extractedText = '';
      }
    } catch (e) {
      logger.warn('Parsing failed; continuing with empty text', e as any);
      statusMessage = 'Parsing failed. Please try a different file or format (PDF, DOCX, or TXT).';
      extractedText = '';
    }

    await docRef.set({
      extractedText,
      status: extractedText && extractedText.trim().length > 0 ? 'ready' : 'failed',
      ...(statusMessage ? { statusMessage } : {}),
      filePath,
      storagePath: filePath,
      bucket: bucketName,
      contentType,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    if (extractedText && extractedText.trim().length > 0) {
      const chunks = chunkTextByWords(extractedText, 900, 120);
      logger.info('Writing chunks', { count: chunks.length, docId });

      // Initialize embedding model
      let embeddingModel: ReturnType<GoogleGenerativeAI['getGenerativeModel']> | null = null;
      try {
        const apiKey = geminiApiKey.value();
        if (apiKey) {
          const genAI = new GoogleGenerativeAI(apiKey);
          embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
        } else {
          logger.warn('GEMINI_API_KEY not available; proceeding without embeddings');
        }
      } catch (e) {
        logger.warn('Failed to initialize embedding model; proceeding without embeddings', e as any);
      }

      const batchSize = 400; // Firestore batch size for writes
      const embedBatchSize = 100; // Safer batch size for embedding API
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = db.batch();
        const slice = chunks.slice(i, i + batchSize);

        // Precompute embeddings for this slice if model is available
        let sliceEmbeddings: number[][] | null = null;
        if (embeddingModel) {
          try {
            sliceEmbeddings = [];
            for (let j = 0; j < slice.length; j += embedBatchSize) {
              const sub = slice.slice(j, j + embedBatchSize);
              const resp = await embeddingModel.batchEmbedContents({
                requests: sub.map((text) => ({
                  content: { parts: [{ text }], role: 'user' },
                  taskType: TaskType.RETRIEVAL_DOCUMENT,
                  outputDimensionality: 768,
                })),
              } as any);
              // resp.embeddings?: { values: number[] }[]
              resp.embeddings.forEach((e) => sliceEmbeddings!.push(e.values));
            }
          } catch (e) {
            logger.warn('Embedding computation failed for slice; continuing without embeddings', e as any);
            sliceEmbeddings = null;
          }
        }

        slice.forEach((text, idx) => {
          const chunkRef = docRef.collection('chunks').doc();
          const base = {
            index: i + idx,
            text,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          } as any;
          if (sliceEmbeddings && sliceEmbeddings[idx]) {
            base.embedding = sliceEmbeddings[idx];
          }
          batch.set(chunkRef, base);
        });
        await batch.commit();
      }
    }

    try { fs.unlinkSync(tmpFilePath); } catch (e) {}
    return;
  } catch (err) {
    logger.error('processUploadedDocument error', err as any);
    throw err;
  }
});
