import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {getFirestore} from "firebase-admin/firestore";
import {GoogleGenerativeAI, TaskType} from "@google/generative-ai";
import {defineSecret} from "firebase-functions/params";
export { processUploadedDocument } from './processUpload';

// Initialize Firebase Admin exactly once
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = getFirestore();

// Define the Gemini API Key as a secret.
// The value is managed by Firebase/Google Cloud.
const geminiApiKey = defineSecret("GEMINI_API_KEY");

/**
 * Cloud Function to handle document Q&A.
 */
// eslint-disable-next-line max-len
export const askQuestion = onCall({secrets: [geminiApiKey]}, async (request) => {
  const {question, documentId, sessionId, remember} = (request.data || {}) as {
    question?: string;
    documentId?: string;
    sessionId?: string;
    remember?: boolean;
  };
  const userId = request.auth?.uid || null;

  if (!userId) {
    throw new HttpsError("unauthenticated", "You must be signed in to ask a question.");
  }
  if (!question || !question.trim()) {
    throw new HttpsError("invalid-argument", "Question is required.");
  }
  if (!documentId || !documentId.trim()) {
    throw new HttpsError("invalid-argument", "documentId is required.");
  }

  // Access the secret value at runtime.
  const apiKey = geminiApiKey.value();
  if (!apiKey) {
    throw new HttpsError(
      "failed-precondition",
      "Gemini API key not configured. Run 'firebase functions:secrets:set GEMINI_API_KEY' and deploy."
    );
  }

  // eslint-disable-next-line max-len
  // Initialize the AI client inside the function, where the secret is available.
  const genAI = new GoogleGenerativeAI(apiKey);

  try {
    const t0 = Date.now();
    // 1. Get document from Firestore
    const docRef = db.collection("documents").doc(documentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new HttpsError("not-found", "Document not found");
    }

    const documentData = doc.data() || {};

    // 2. Load precomputed chunks if available; fallback to extractedText split
    //    Include stored embeddings when available for faster queries
    let chunks: { id: string; index: number; text: string; embedding?: number[] }[] = [];
    const chunksSnap = await docRef.collection('chunks').orderBy('index', 'asc').get();
    if (!chunksSnap.empty) {
      chunks = chunksSnap.docs.map((d) => {
        const data = d.data() as any;
        const emb = Array.isArray(data.embedding) ? (data.embedding as number[]) : undefined;
        return { id: d.id, index: data.index ?? 0, text: data.text || "", embedding: emb };
      });
      console.log('Using precomputed chunks (with embeddings when available):', chunks.length);
    } else {
      const documentText = (documentData as any)?.extractedText || "";
      if (!documentText || !documentText.trim()) {
        throw new HttpsError(
          "failed-precondition",
          "Document has no extracted text yet. Please try again later."
        );
      }
      const fallback = chunkTextByWords(documentText, 900, 120); // ~900-word chunks with overlap for better semantic coverage
      chunks = fallback.map((t, i) => ({ id: `fallback_${i}`, index: i, text: t }));
      console.log('Using fallback chunks from extractedText:', chunks.length);
    }

    // 3. Conversation memory (optional, if remember == true and sessionId present)
    let memoryContext = '';
    let summaryText = '';
    if (remember && sessionId) {
      const userIdSafe = userId as string;
      const msgsSnap = await db.collection('users').doc(userIdSafe)
        .collection('sessions').doc(sessionId)
        .collection('messages').orderBy('timestamp', 'asc').get();
      const msgs = msgsSnap.docs.map((d) => d.data() as any);
      const turns = msgs.map((m) => `${m.sender === 'user' ? 'User' : 'Assistant'}: ${m.text || ''}`);
      const N = 3;
      if (turns.length > 0) {
        const tail = turns.slice(-N);
        memoryContext = tail.join('\n');
      }
      if (turns.length > 6) {
        // Summarize older turns
        const historyToSummarize = turns.slice(0, -N).join('\n');
        try {
          const sumModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
          const sumPrompt = `Summarize the following conversation history in 5-8 concise bullet points, capturing user intents and constraints.\n\n${historyToSummarize}`;
          const sumResp = await sumModel.generateContent(sumPrompt);
          summaryText = sumResp.response.text();
        } catch (e) {
          console.warn('Summarization failed; continuing without summary');
        }
      }
    }

    // 4. Prefilter and cap chunks, then compute similarities using 768-dim question embedding
    const prefilteredIdx = prefilterChunks(question, chunks.map((c) => c.text), 60);
    const filtered = prefilteredIdx.map((i) => chunks[i]);
    const filteredTexts = filtered.map((c) => c.text);
    const filteredEmbeddings = filtered.map((c) => c.embedding);
    await findRelevantChunks(question, filteredTexts, filteredEmbeddings, genAI);
    // map back to source chunks to compute similarities and ids
    // We'll recompute similarities here to choose dynamic K and capture indices
    const embeddingModel = genAI.getGenerativeModel({model: 'gemini-embedding-001'});
    const qEmbedding = await embeddingModel.embedContent({
      content: { parts: [{ text: question }], role: 'user' },
      taskType: TaskType.RETRIEVAL_QUERY,
      outputDimensionality: 768,
    } as any);
    // ensure we have embeddings for filtered; backfill any newly computed 768-dim vectors
    const filteredComputed: number[][] = [];
    const toBackfill: Array<{ id: string; values: number[] }> = [];
    const targetDim = qEmbedding.embedding.values.length;
    for (let i = 0; i < filtered.length; i++) {
      const known = filteredEmbeddings[i];
      const needReembed = !known || !Array.isArray(known) || known.length !== targetDim;
      if (!needReembed) {
        filteredComputed.push(known as number[]);
      } else {
        const resp = await embeddingModel.embedContent({
          content: { parts: [{ text: filteredTexts[i] }], role: 'user' },
          taskType: TaskType.RETRIEVAL_DOCUMENT,
          outputDimensionality: 768,
        } as any);
        const vals = resp.embedding.values;
        filteredComputed.push(vals);
        const cid = filtered[i].id;
        if (!cid.startsWith('fallback_')) {
          toBackfill.push({ id: cid, values: vals });
        }
      }
    }
    if (toBackfill.length > 0) {
      try {
        const batch = db.batch();
        for (const item of toBackfill) {
          const cref = docRef.collection('chunks').doc(item.id);
          batch.update(cref, { embedding: item.values });
        }
        await batch.commit();
      } catch (e) {
        console.warn('Failed to backfill embeddings; continuing without persistence');
      }
    }
    const sims = filteredComputed.map((e) => cosineSimilarity(qEmbedding.embedding.values, e));
    const maxSim = Math.max(...sims);
    const k = maxSim >= 0.8 ? 2 : (maxSim < 0.6 ? 6 : 4);
    const topIdx = sims.map((s, i) => ({ s, i }))
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map((x) => x.i);
    const topChunks = topIdx.map((i) => filtered[i]);

    // 5. Build prompt with system instruction, memory, and top chunks
    const sys = `You are a legal assistant. Answer ONLY from the provided document chunks. Use plain language. Flag risky clauses with 🚩. If unsure, say you don't know. Start with a brief 'Summary' section, then provide details.`;
    let contextBlock = '';
    if (summaryText) contextBlock += `\nSummary of earlier conversation: \n${summaryText}\n`;
    if (memoryContext) contextBlock += `\nRecent conversation (last 3 turns):\n${memoryContext}\n`;
    const chunkBlock = topChunks.map((c, idx) => `[[chunkId: ${c.id}]]\n${c.text}`).join('\n\n');
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const plainPrompt = `${sys}\n\n${contextBlock}\nQuestion: ${question}\n\nDOCUMENT CHUNKS:\n${chunkBlock}\n\nWrite a detailed, plain-language answer in this exact format:\n\nSummary:\n- 1–2 short paragraphs summarizing the answer in plain language.\n\nKey Clauses:\n- Use markers: 🚩 (HIGH risk), ⚠️ (MEDIUM risk), ℹ️ (LOW).\n- List the key clauses found in the chunks with short explanations.\n\nCitations:\n- Provide short snippets with [[chunkId: ...]] references.\n\n---\nQuick Takeaway (2 or 3 or 4 lines):\n<Concise plain-language summary>\n---`;
    const genResp = await model.generateContent(plainPrompt);
    const answer = genResp.response.text();

    // 6. Post-process: citations, flagged clauses, follow-ups
    const citations = topChunks.map((c) => ({ chunkId: c.id, snippet: (c.text || '').slice(0, 200) }));
    const flaggedClauses = detectRiskyClauses(topChunks);

    // Follow-ups: generate briefly (optional)
    let followUps: string[] = [];
    try {
      const fuPrompt = `Given the user's question and the answer, propose 2 concise follow-up questions.\nQuestion: ${question}\nAnswer: ${answer}\nReturn as a simple list.`;
      const fuResp = await model.generateContent(fuPrompt);
      const fuText = fuResp.response.text();
      followUps = fuText.split(/\n+/).map((l) => l.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean).slice(0, 2);
    } catch {}

    // 7. Do not persist AI message here; frontend will persist to avoid duplication.

    const t1 = Date.now();
    return {
      answer,
      citations,
      flaggedClauses,
      followUps,
      meta: {
        timeMs: t1 - t0,
        topChunkIds: topChunks.map((c) => c.id),
      },
    };
  } catch (error) {
    console.error("Error:", error);
    if (error instanceof HttpsError) {
      throw error;
    }
    // Throwing an HttpsError is the proper way to report errors from a callable function.
    throw new HttpsError(
      "internal",
      "An unexpected error occurred while processing your question."
    );
  }
});

/**
 * Delete a document and its assets.
 * Input: { documentId: string }
 */
export const deleteFile = onCall({}, async (request) => {
  const userId = request.auth?.uid || null;
  if (!userId) throw new HttpsError('unauthenticated', 'Sign in required');
  const { documentId } = (request.data || {}) as { documentId?: string };
  if (!documentId) throw new HttpsError('invalid-argument', 'documentId is required');

  const docRef = db.collection('documents').doc(documentId);
  const snap = await docRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Document not found');
  const data = snap.data() as any;
  if (data?.userId && data.userId !== userId) throw new HttpsError('permission-denied', 'Not your document');

  // Delete Storage file
  const bucketName = data?.bucket || undefined; // default bucket if undefined
  const storagePath = data?.storagePath || data?.filePath || undefined;
  try {
    if (storagePath) {
      const bucket = bucketName ? admin.storage().bucket(bucketName) : admin.storage().bucket();
      await bucket.file(storagePath).delete({ ignoreNotFound: true });
    }
  } catch (e) {
    console.warn('Storage delete failed (continuing):', e);
  }

  // Delete subcollections (chunks)
  try {
    const chunksSnap = await docRef.collection('chunks').get();
    if (!chunksSnap.empty) {
      const batch = db.batch();
      chunksSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (e) {
    console.warn('Failed deleting subcollections; continuing', e);
  }

  // Delete the main document
  await docRef.delete();
  return { success: true };
});

/**
 * Helper: split text into ~N-word chunks (better semantic coverage for RAG)
 */
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

/**
 * Helper function to find relevant chunks using embeddings.
 * This is a more advanced implementation than the original.
 * In a production application, you would typically pre-calculate and store
 * the embeddings for your document chunks in a vector database for faster retrieval.
 * @param {string} question - The user's question.
 * @param {string[]} chunks - Array of text chunks to search through.
 * @param {GoogleGenerativeAI} genAI - The initialized GenerativeAI client.
 */
async function findRelevantChunks(
  question: string,
  chunks: string[],
  knownEmbeddings: (number[] | undefined)[] | undefined,
  genAI: GoogleGenerativeAI
): Promise<string[]> {
  // eslint-disable-next-line max-len
  const embeddingModel = genAI.getGenerativeModel({model: "gemini-embedding-001"});

  // 1. Get embedding for the user's question.
  const questionEmbedding = await embeddingModel.embedContent ({ // eslint-disable-line max-len
    content: {parts: [{text: question}], role: "user"},
    taskType: TaskType.RETRIEVAL_QUERY,
    // Use smaller dimensionality for storage and compute efficiency
    outputDimensionality: 768,
  } as any);

  // 2. Ensure we have embeddings for all provided chunks.
  const missingIndices: number[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const known = knownEmbeddings?.[i];
    // Re-embed if missing or if dimensionality mismatches the question embedding
    if (!known || !Array.isArray(known) || known.length !== questionEmbedding.embedding.values.length) {
      missingIndices.push(i);
    }
  }
  const computedMap = new Map<number, number[]>();
  if (missingIndices.length > 0) {
    const resp = await embeddingModel.batchEmbedContents({
      requests: missingIndices.map((i) => ({
        content: {parts: [{text: chunks[i]}], role: 'user'},
        taskType: TaskType.RETRIEVAL_DOCUMENT,
        outputDimensionality: 768,
      })),
    } as any);
    resp.embeddings.forEach((e, idx) => {
      const origIndex = missingIndices[idx];
      computedMap.set(origIndex, e.values);
    });
  }
  const embeddings: number[][] = chunks.map((_, i) => {
    const known = knownEmbeddings?.[i];
    return (known && Array.isArray(known)) ? known : (computedMap.get(i) as number[]);
  });

  // 3. Find the most similar chunks to the question using cosine similarity.
  const qvec = questionEmbedding.embedding.values;
  const similarities = embeddings.map((e) => cosineSimilarity(qvec, e));

  // 4. Return the top N chunks.
  const topN = 4;
  const topIndices = similarities
    .map((similarity, index) => ({similarity, index}))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topN)
    .map((item) => item.index);

  return topIndices.map((index) => chunks[index]);
}

/**
 * Prefilter chunks using simple keyword scoring and cap the number of chunks.
 * This reduces embedding load and prevents timeouts/500s on very large documents.
 */
function prefilterChunks(question: string, chunks: string[], cap = 150): number[] {
  try {
    const terms = (question || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .filter((t) => t.length > 2);
    const take = Math.min(cap, chunks.length);
    if (terms.length === 0) {
      return Array.from({ length: take }, (_, i) => i);
    }
    const scored = chunks.map((c, i) => {
      const lc = (c || "").toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (lc.includes(t)) score += 1;
      }
      return { i, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const topIdx = scored.slice(0, take).map((s) => s.i);
    // If everything scores 0 (no overlap), just take first cap indices
    const hasSignal = scored[0] && scored[0].score > 0;
    return hasSignal ? topIdx : Array.from({ length: take }, (_, i) => i);
  } catch {
    const take = Math.min(cap, chunks.length);
    return Array.from({ length: take }, (_, i) => i);
  }
}

/**
 * Calculates the cosine similarity between two vectors.
 * @param {number[]} vecA - The first vector.
 * @param {number[]} vecB - The second vector.
 * @return {number} The cosine similarity.
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Heuristic detection of risky clauses by keyword categories.
 */
function detectRiskyClauses(chunks: { id: string; text: string }[]): Array<{ chunkId: string; text: string; risk: 'HIGH'|'MEDIUM'|'LOW'; symbol: string }>{
  const HIGH = ['termination', 'liability', 'penalties', 'arbitration'];
  const MED = ['fees', 'renewal', 'data sharing'];
  const LOW = ['definitions', 'general information', 'general info'];
  const out: Array<{ chunkId: string; text: string; risk: 'HIGH'|'MEDIUM'|'LOW'; symbol: string }> = [];
  for (const c of chunks) {
    const t = (c.text || '').toLowerCase();
    let matched: { risk: 'HIGH'|'MEDIUM'|'LOW'; symbol: string } | null = null;
    if (HIGH.some(k => t.includes(k))) matched = { risk: 'HIGH', symbol: '🚩' };
    else if (MED.some(k => t.includes(k))) matched = { risk: 'MEDIUM', symbol: '⚠️' };
    else if (LOW.some(k => t.includes(k))) matched = { risk: 'LOW', symbol: 'ℹ️' };
    if (matched) {
      out.push({ chunkId: c.id, text: c.text.slice(0, 400), risk: matched.risk, symbol: matched.symbol });
    }
  }
  return out.slice(0, 8);
}