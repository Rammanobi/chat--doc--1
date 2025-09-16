import React from 'react';
import UploadPopover from './UploadPopover';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  remember: boolean;
  onToggleRemember: (v: boolean) => void;
  placeholder?: string;
}

const MessageInput: React.FC<Props> = ({ value, onChange, onSubmit, disabled = false, remember, onToggleRemember, placeholder }) => {
  return (
    <div className="space-y-2">
      <div className="relative flex items-center gap-2">
        <div className="absolute left-3">
          <UploadPopover />
        </div>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={placeholder || 'Type your message'}
          disabled={disabled}
          className="w-full rounded-xl border border-slate-700/70 bg-slate-800/80 pl-12 pr-36 py-3 text-slate-100 placeholder:text-slate-400 outline-none focus:border-slate-600 focus:ring-2 focus:ring-blue-500/40"
        />
        <div className="absolute right-3 flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => onToggleRemember(e.target.checked)}
              className="accent-blue-500"
            />
            <span className="opacity-80">Remember my session</span>
          </label>
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled || !value.trim()}
            className={`h-9 px-3 rounded-lg text-white ${disabled || !value.trim() ? 'bg-blue-600/50 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500'}`}
            title="Send"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

export default MessageInput;
