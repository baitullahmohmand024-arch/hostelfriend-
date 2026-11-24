import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Poll } from '../types';
import {
  createPoll,
  POLL_OPTION_MAX_LEN,
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
  POLL_QUESTION_MAX,
  validatePollInput,
} from '../services/pollService';
import { formatUserFriendlyError } from '../lib/firestoreError';
import { playSound } from '../utils/soundVfx';
import { Avatar } from './Avatar';

interface PollCreatorProps {
  onPollCreated: (poll: Poll) => void;
  onCancel: () => void;
  showPreviewByDefault?: boolean;
}

export function PollCreator({
  onPollCreated,
  onCancel,
  showPreviewByDefault = false,
}: PollCreatorProps) {
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [showPreview, setShowPreview] = useState(showPreviewByDefault);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const submittingRef = useRef(false);

  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();
    options.forEach((opt) => {
      const clean = opt.trim().replace(/\s+/g, ' ').toLowerCase();
      if (clean) {
        counts.set(clean, (counts.get(clean) || 0) + 1);
      }
    });
    const dupes = new Set<string>();
    counts.forEach((count, key) => {
      if (count > 1) dupes.add(key);
    });
    return dupes;
  }, [options]);

  const validation = useMemo(
    () => validatePollInput(question, options),
    [question, options]
  );

  const handleOptionChange = (index: number, value: string) => {
    setErrorMsg('');
    setOptions((prev) => prev.map((item, i) => (i === index ? value : item)));
  };

  const handleAddOption = () => {
    if (submitting || options.length >= POLL_OPTIONS_MAX) return;
    setErrorMsg('');
    playSound('ui-tap');
    setOptions((prev) => [...prev, '']);
  };

  const handleRemoveOption = (index: number) => {
    if (submitting || options.length <= POLL_OPTIONS_MIN) return;
    setErrorMsg('');
    playSound('ui-tap');
    setOptions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || submittingRef.current) return;

    if (!validation.valid) {
      setErrorMsg(validation.error || 'Complete your poll question and options first.');
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setErrorMsg('');
    playSound('upload-start');

    try {
      const created = await createPoll({
        author: profile,
        question,
        options,
      });
      playSound('upload-success');
      showToast({
        type: 'success',
        title: 'Poll published!',
        description: 'Your poll is live in the Hostel Friend feed.',
      });
      setQuestion('');
      setOptions(['', '']);
      onPollCreated(created);
    } catch (err) {
      playSound('error');
      setErrorMsg(formatUserFriendlyError(err, 'Could not publish your poll. Please try again.'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const previewQuestion = question.trim() || 'Your poll question will appear here...';
  const previewOptions = options.map((opt, idx) => opt.trim() || `Option ${idx + 1}`);

  return (
    <form onSubmit={handleSubmit} className="space-y-3.5" aria-label="Create a poll">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar
            src={profile?.avatarUrl}
            name={profile?.fullName || 'Hostel Friend'}
            size="sm"
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-ink truncate">
              {profile?.fullName}
            </p>
            <p className="text-[11px] text-accent flex items-center gap-1 truncate">
              <BarChart3 className="w-3 h-3 shrink-0" />
              <span>Creating Interactive Poll</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            disabled={submitting}
            onClick={() => setShowPreview((p) => !p)}
            aria-pressed={showPreview}
            className={`min-h-[36px] px-2.5 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-45 ${
              showPreview
                ? 'bg-accent/15 border-accent/40 text-accent'
                : 'bg-surface-2 border-hairline text-ink-muted hover:text-ink'
            }`}
          >
            {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{showPreview ? 'Hide Preview' : 'Preview'}</span>
          </button>

          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            aria-label="Cancel poll creation"
            className="min-w-[38px] min-h-[38px] flex items-center justify-center rounded-xl text-ink-muted hover:text-ink hover:bg-hover-tint transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300 flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Question Input */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <label htmlFor="poll-question-input" className="font-semibold text-ink-muted">
            Poll Question
          </label>
          <span className="font-mono tabular-nums text-ink-subtle">
            {question.trim().length}/{POLL_QUESTION_MAX}
          </span>
        </div>
        <textarea
          id="poll-question-input"
          rows={2}
          maxLength={POLL_QUESTION_MAX}
          disabled={submitting}
          value={question}
          onChange={(e) => {
            setErrorMsg('');
            setQuestion(e.target.value);
          }}
          placeholder="Ask your hostel community something... (e.g. Best chai spot near Block A?)"
          className="w-full rounded-xl bg-canvas border border-hairline px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent resize-none disabled:opacity-60"
        />
      </div>

      {/* Options List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-semibold text-ink-muted">
            Answer Options ({options.length}/{POLL_OPTIONS_MAX})
          </span>
          <span className="text-ink-subtle">2 to 6 unique choices</span>
        </div>

        <div className="space-y-2">
          {options.map((option, idx) => {
            const normalized = option.trim().replace(/\s+/g, ' ').toLowerCase();
            const isDuplicate = Boolean(normalized && duplicateKeys.has(normalized));
            return (
              <div key={idx} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-10 rounded-lg bg-canvas-alt border border-hairline text-xs font-mono font-semibold text-accent flex items-center justify-center shrink-0">
                    {idx + 1}
                  </span>
                  <input
                    type="text"
                    maxLength={POLL_OPTION_MAX_LEN}
                    disabled={submitting}
                    value={option}
                    onChange={(e) => handleOptionChange(idx, e.target.value)}
                    placeholder={`Option ${idx + 1}`}
                    aria-label={`Poll option ${idx + 1}`}
                    className={`flex-1 min-h-[42px] rounded-xl bg-canvas border px-3.5 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none disabled:opacity-60 transition-colors ${
                      isDuplicate
                        ? 'border-rose-500/60 focus:border-rose-400'
                        : 'border-hairline focus:border-accent'
                    }`}
                  />
                  {options.length > POLL_OPTIONS_MIN && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleRemoveOption(idx)}
                      aria-label={`Remove option ${idx + 1}`}
                      className="min-w-[40px] min-h-[40px] rounded-xl border border-hairline bg-canvas text-ink-muted hover:text-rose-400 hover:border-rose-500/40 flex items-center justify-center transition-colors disabled:opacity-45 shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {isDuplicate && (
                  <p className="pl-9 text-[11px] text-rose-400">
                    Duplicate option — each choice must be unique.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {options.length < POLL_OPTIONS_MAX && (
          <button
            type="button"
            disabled={submitting}
            onClick={handleAddOption}
            className="min-h-[38px] px-3.5 rounded-xl border border-dashed border-accent/45 hover:border-accent bg-accent/5 hover:bg-accent/10 text-xs font-semibold text-accent inline-flex items-center gap-1.5 transition-colors disabled:opacity-45"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add option ({options.length}/{POLL_OPTIONS_MAX})</span>
          </button>
        )}
      </div>

      {/* Live Poll Preview */}
      {showPreview && (
        <div className="rounded-xl bg-canvas-alt border border-accent/25 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between text-[11px] text-ink-muted">
            <span className="font-semibold text-accent inline-flex items-center gap-1">
              <Eye className="w-3 h-3" />
              <span>Live Poll Preview</span>
            </span>
            <span>0 votes · Just now</span>
          </div>
          <p className="text-sm font-display font-semibold text-ink break-words">
            {previewQuestion}
          </p>
          <div className="space-y-1.5">
            {previewOptions.map((label, idx) => (
              <div
                key={idx}
                className="min-h-[38px] px-3 py-2 rounded-lg bg-surface border border-hairline text-xs text-ink-2 flex items-center justify-between gap-2"
              >
                <span className="truncate">{label}</span>
                <span className="text-[11px] font-mono text-ink-subtle shrink-0">0%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer Actions */}
      <div className="pt-2 border-t border-hairline flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={submitting}
          onClick={onCancel}
          className="min-h-[40px] px-4 rounded-xl border border-hairline bg-surface-2 hover:bg-surface-hover text-xs font-medium text-ink-muted hover:text-ink transition-colors disabled:opacity-45"
        >
          Cancel
        </button>

        <button
          type="submit"
          disabled={submitting || !validation.valid}
          className="min-h-[40px] gold-gradient-btn px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-45 whitespace-nowrap"
        >
          {submitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Publishing Poll...</span>
            </>
          ) : (
            <>
              <Send className="w-3.5 h-3.5" />
              <span>Publish Poll</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}
