import React, { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';

interface Props {
  text: string;
  className?: string;
}

const CopyButton: React.FC<Props> = ({ text, className = '' }) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let t: number | undefined;
    if (copied) {
      t = window.setTimeout(() => setCopied(false), 2000);
    }
    return () => {
      if (t) window.clearTimeout(t);
    };
  }, [copied]);

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {}
  };

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={doCopy}
        className="opacity-70 hover:opacity-100 transition"
        title="Copy to clipboard"
      >
        <Copy size={16} />
      </button>
      {copied && (
        <div className="absolute -top-7 right-0 px-2 py-1 rounded bg-black text-white text-xs shadow-md">
          Copied!
        </div>
      )}
    </div>
  );
};

export default CopyButton;
