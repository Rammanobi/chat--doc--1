import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';

interface Props {
  onConfirm: () => void | Promise<void>;
  className?: string;
  size?: number;
  tooltip?: string;
}

const DeleteButton: React.FC<Props> = ({ onConfirm, className = '', size = 16, tooltip = 'Delete' }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    try {
      setBusy(true);
      await onConfirm();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        type="button"
        disabled={busy}
        className={`p-1 rounded hover:bg-slate-700 ${busy ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={tooltip}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        <Trash2 size={size} />
      </button>
      {open && (
        <div className="absolute z-20 top-7 right-0 bg-slate-900 text-white text-xs rounded shadow-lg p-2 w-36">
          <div className="mb-2">Delete this?</div>
          <div className="flex justify-end gap-2">
            <button
              className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600"
              onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            >
              Cancel
            </button>
            <button
              className="px-2 py-1 rounded bg-red-600 hover:bg-red-500"
              onClick={(e) => { e.stopPropagation(); handleConfirm(); }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeleteButton;
