// src/components/UploadPopover.tsx
import { useState } from "react";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { collection, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { storage, db } from "../firebase";
import { useAuth } from "../contexts/AuthContext"; // Import the useAuth hook
import { Paperclip, X } from "lucide-react";
import { useChatSessions } from "../contexts/ChatSessionsContext";
import { useSelectedDoc } from "../contexts/SelectedDocContext";

export default function UploadPopover() {
  const { user } = useAuth(); // Get the current user
  const { activeSessionId } = useChatSessions();
  const { setSelectedDocId } = useSelectedDoc();
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleUpload = async (file: File) => {
    if (!file) return;
    setUploading(true);

    if (!user) {
      setUploading(false);
      return;
    }

    // Create a Firestore document first to get a stable docId
    const docRef = doc(collection(db, "documents"));
    await setDoc(docRef, {
      userId: user.uid,
      sessionId: activeSessionId,
      fileName: file.name,
      size: file.size,
      createdAt: serverTimestamp(),
      status: "uploaded",
    }, { merge: true });

    // Upload to Storage with custom metadata including docId
    const storagePath = `documents/${docRef.id}/${file.name}`;
    const storageRef = ref(storage, storagePath);
    const uploadTask = uploadBytesResumable(storageRef, file, {
      contentType: file.type,
      customMetadata: {
        docId: docRef.id,
        userId: user.uid,
        sessionId: activeSessionId,
      }
    });

    uploadTask.on("state_changed",
      (snapshot) => {
        const prog = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        setProgress(prog);
      },
      (error) => {
        console.error("Upload failed", error);
        setUploading(false);
      },
      async () => {
        const url = await getDownloadURL(uploadTask.snapshot.ref);
        // Update the existing doc with the download URL
        await setDoc(docRef, { url }, { merge: true });
        // Auto-select the newly uploaded document for this session
        setSelectedDocId(docRef.id);

        setUploading(false);
        setOpen(false); // close popover after upload
      }
    );
  };

  return (
    <div className="relative inline-block">
      {/* Icon to toggle popover */}
      <button
        onClick={() => setOpen(!open)}
        className="p-2 rounded-full hover:bg-gray-700 transition"
      >
        <Paperclip size={20} />
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute bottom-12 -left-2 bg-gray-800 text-white text-sm p-3 rounded-lg shadow-lg w-56">
           <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold">Upload Files</h3>
            <button onClick={() => setOpen(false)} className="p-1 rounded-full hover:bg-gray-700">
                <X size={16} />
            </button>
          </div>
          <label className="cursor-pointer flex items-center space-x-2 p-2 hover:bg-gray-700 rounded-md">
            <Paperclip size={16} />
            <span>Select file</span>
            <input
              type="file"
              hidden
              accept=".pdf,.doc,.docx, .txt"
              onChange={(e) => e.target.files && handleUpload(e.target.files[0])}
            />
          </label>
          {uploading && (
            <div className="mt-2 text-xs">
              <div className="w-full bg-gray-600 rounded-full h-2">
                <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${progress}%` }}></div>
              </div>
              <p className="mt-1">Uploading… {progress.toFixed(0)}%</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
