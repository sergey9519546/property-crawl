'use client';
// Mounted in src/components/documents/document-review-queue.tsx for dual-pane speed review of ambiguous legal notices.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Check,
  X,
  Edit2,
  ChevronRight,
  ChevronLeft,
  FileText,
  AlertCircle,
  Keyboard,
  ShieldCheck
} from 'lucide-react';
import { useLocale } from '@/components/i18n/locale-provider';
import { formatUsd, interpolate } from '@/lib/i18n/translator';

export interface EvidenceSpan {
  quote: string;
  start: number;
  end: number;
  verified: boolean;
}

export interface DocumentReviewItem {
  id: string;
  listingId: string;
  sourceUrl?: string;
  rawText: string;
  extractedFields: {
    caseNumber?: string;
    defendant?: string;
    plaintiff?: string;
    openingBid?: number;
    judgmentAmount?: number;
    saleDate?: string;
    apn?: string;
    confidenceScore?: number;
    evidenceSpans?: Record<string, EvidenceSpan>;
  };
  reviewStatus: 'pending' | 'approved' | 'rejected';
}

function resolveVerbatimSpan(
  rawText: string | undefined,
  fieldKey: string,
  value: unknown,
  providedSpans?: Record<string, EvidenceSpan>
): EvidenceSpan | null {
  if (!rawText || value === null || value === undefined || value === '' || value === 0) return null;
  const provided = providedSpans?.[fieldKey];
  if (provided && provided.start >= 0 && provided.end <= rawText.length && rawText.slice(provided.start, provided.end) === provided.quote) {
    return { ...provided, verified: true };
  }
  const candidates: string[] = [];
  if (typeof value === 'number') {
    candidates.push(`$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    candidates.push(`$${value.toLocaleString('en-US')}`);
    candidates.push(value.toLocaleString('en-US'));
    candidates.push(String(value));
  } else {
    candidates.push(String(value).trim());
  }
  for (const candidate of candidates) {
    if (!candidate) continue;
    const idx = rawText.indexOf(candidate);
    if (idx >= 0) {
      return { quote: candidate, start: idx, end: idx + candidate.length, verified: true };
    }
  }
  const normalizedRaw = rawText.replace(/[\u00A0\r\n\t]/g, ' ');
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalizedCandidate = candidate.replace(/[\u00A0\r\n\t]/g, ' ');
    const normIdx = normalizedRaw.indexOf(normalizedCandidate);
    if (normIdx >= 0) {
      return { quote: rawText.slice(normIdx, normIdx + candidate.length), start: normIdx, end: normIdx + candidate.length, verified: true };
    }
  }
  return { quote: String(value), start: -1, end: -1, verified: false };
}

interface ReviewSplitPaneProps {
  items: DocumentReviewItem[];
  onApprove: (id: string, updatedFields?: any, note?: string) => Promise<boolean | void> | boolean | void;
  onReject: (id: string, note?: string, updatedFields?: any) => Promise<boolean | void> | boolean | void;
  onUpdateFields?: (id: string, fields: any) => void;
}

function safeExternalUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function ReviewSplitPane({
  items = [],
  onApprove,
  onReject,
  onUpdateFields
}: ReviewSplitPaneProps) {
  const { locale, messages } = useLocale();
  const t = messages.reviewB2;
  const fmtMoney = (value: number) => formatUsd(locale, value);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editedFields, setEditedFields] = useState<any>({});
  const [reviewNote, setReviewNote] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  const [pendingAdvanceFromId, setPendingAdvanceFromId] = useState<string | null>(null);
  const lastResetIdRef = useRef<string | null>(null);

  const safeIndex = items.length > 0 ? Math.min(currentIndex, items.length - 1) : 0;
  const currentItem = items[safeIndex];
  const currentItemId = currentItem?.id ?? null;

  useEffect(() => {
    if (safeIndex !== currentIndex) {
      setCurrentIndex(safeIndex);
    }
  }, [safeIndex, currentIndex]);

  useEffect(() => {
    if (currentItem && currentItemId !== lastResetIdRef.current) {
      lastResetIdRef.current = currentItemId;
      setEditedFields({ ...currentItem.extractedFields });
      setEditMode(false);
      setReviewNote('');
      setActiveFieldKey(null);
      setValidationError(null);
    } else if (!currentItem) {
      lastResetIdRef.current = null;
    }
  }, [currentItemId, currentItem]);

  useEffect(() => {
    if (!pendingAdvanceFromId) return;
    const stillPresentIndex = items.findIndex((item) => item.id === pendingAdvanceFromId);
    if (stillPresentIndex !== -1 && stillPresentIndex < items.length - 1) {
      setCurrentIndex(stillPresentIndex + 1);
    }
    setPendingAdvanceFromId(null);
  }, [items, pendingAdvanceFromId]);

  const handleNext = useCallback(() => {
    if (safeIndex < items.length - 1) {
      setCurrentIndex(safeIndex + 1);
    }
  }, [safeIndex, items.length]);

  const handlePrev = useCallback(() => {
    if (safeIndex > 0) {
      setCurrentIndex(safeIndex - 1);
    }
  }, [safeIndex]);

  const handleApproveCurrent = useCallback(async () => {
    if (!currentItem) return;
    setValidationError(null);
    const actedId = currentItem.id;
    const fields = editMode ? editedFields : currentItem.extractedFields;
    if (editMode && onUpdateFields) onUpdateFields(actedId, editedFields);
    const result = await onApprove(actedId, fields, reviewNote.trim() || undefined);
    if (result !== false) setPendingAdvanceFromId(actedId);
  }, [currentItem, editMode, editedFields, onApprove, onUpdateFields, reviewNote]);

  const handleRejectCurrent = useCallback(async () => {
    if (!currentItem) return;
    const actedId = currentItem.id;
    if (!reviewNote.trim()) {
      setValidationError(t.spErrRejectNote);
      return;
    }
    setValidationError(null);
    const fields = editMode ? editedFields : currentItem.extractedFields;
    const result = await onReject(actedId, reviewNote.trim() || undefined, fields);
    if (result !== false) setPendingAdvanceFromId(actedId);
  }, [currentItem, editMode, editedFields, onReject, reviewNote, t.spErrRejectNote]);

  // Keyboard shortcut handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const target = e.target as HTMLElement | null;
      // Don't trigger if operator is typing in an input (except Escape to exit)
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) {
        if (e.key === 'Escape') {
          target.blur();
          setEditMode(false);
          setActiveFieldKey(null);
          setValidationError(null);
        }
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'a':
          e.preventDefault();
          void handleApproveCurrent();
          break;
        case 'r':
          e.preventDefault();
          void handleRejectCurrent();
          break;
        case 'e':
          e.preventDefault();
          setEditMode((prev) => !prev);
          break;
        case 'j':
          e.preventDefault();
          handleNext();
          break;
        case 'k':
          e.preventDefault();
          handlePrev();
          break;
        case 'escape':
          e.preventDefault();
          setEditMode(false);
          setActiveFieldKey(null);
          setValidationError(null);
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleApproveCurrent, handleRejectCurrent, handleNext, handlePrev]);

  if (!items || items.length === 0) {
    return (
      <div className="p-12 text-center text-ink-3 bg-card rounded-card border border-line">
        <FileText className="w-8 h-8 mx-auto text-ink-3 mb-2" />
        <p className="font-semibold text-ink-2">{t.spEmptyTitle}</p>
        <p className="text-xs text-ink-3">{t.spEmptyBody}</p>
      </div>
    );
  }

  const confidence = typeof currentItem?.extractedFields?.confidenceScore === 'number'
    ? currentItem.extractedFields.confidenceScore
    : null;
  const isHighConfidence = confidence !== null && confidence >= 0.8;

  const rawText = currentItem?.rawText || '';
  const spansByField: Record<string, EvidenceSpan | null> = {
    caseNumber: resolveVerbatimSpan(rawText, 'case_number', currentItem?.extractedFields?.caseNumber, currentItem?.extractedFields?.evidenceSpans),
    defendant: resolveVerbatimSpan(rawText, 'defendant', currentItem?.extractedFields?.defendant, currentItem?.extractedFields?.evidenceSpans),
    plaintiff: resolveVerbatimSpan(rawText, 'plaintiff_or_seller', currentItem?.extractedFields?.plaintiff, currentItem?.extractedFields?.evidenceSpans),
    openingBid: resolveVerbatimSpan(rawText, 'opening_bid', currentItem?.extractedFields?.openingBid, currentItem?.extractedFields?.evidenceSpans),
    judgmentAmount: resolveVerbatimSpan(rawText, 'judgment_amount', currentItem?.extractedFields?.judgmentAmount, currentItem?.extractedFields?.evidenceSpans),
    saleDate: resolveVerbatimSpan(rawText, 'sale_date', currentItem?.extractedFields?.saleDate, currentItem?.extractedFields?.evidenceSpans),
    apn: resolveVerbatimSpan(rawText, 'apn', currentItem?.extractedFields?.apn, currentItem?.extractedFields?.evidenceSpans),
  };
  const activeSpan = activeFieldKey ? spansByField[activeFieldKey] : null;
  const canHighlight = Boolean(activeSpan && activeSpan.verified && activeSpan.start >= 0 && activeSpan.end > activeSpan.start);

  function renderSpanBadge(fieldKey: string) {
    const span = spansByField[fieldKey];
    if (!span) return null;
    if (span.verified) {
      const isSelected = activeFieldKey === fieldKey;
      return (
        <button
          type="button"
          onClick={() => setActiveFieldKey(isSelected ? null : fieldKey)}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-label font-semibold transition ${
            isSelected
              ? 'bg-signature text-ink ring-1 ring-ink/30'
              : 'bg-paper text-ink hover:bg-line/60 border border-line-strong'
          }`}
          title={interpolate(t.spVerifiedTitle, { start: span.start, end: span.end, quote: span.quote })}
        >
          <ShieldCheck className="w-3 h-3" />
          <span>{isSelected ? t.spHighlightedBadge : t.spVerifiedSpanBadge}</span>
        </button>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1 rounded bg-catch-wash border border-catch/30 px-1.5 py-0.5 text-label font-semibold text-catch-ink"
        title={t.spUnverifiedTitle}
      >
        <AlertCircle className="w-3 h-3" />
        <span>{t.spUnverifiedBadge}</span>
      </span>
    );
  }

  return (
    <div className="bg-card rounded-card border border-line shadow-sm overflow-hidden flex flex-col h-[750px]">
      {/* Top Navigation & Shortcut Legend */}
      <div className="bg-ink text-white px-5 py-3 flex items-center justify-between text-xs border-b border-ink-2">
        <div className="flex items-center gap-3">
          <span className="font-bold tracking-tight">{t.spHeaderTitle}</span>
          <span className="bg-ink-2 text-paper px-2 py-0.5 rounded font-mono text-xs">
            {interpolate(t.spIndexOfTotal, { current: safeIndex + 1, total: items.length })}
          </span>
          {currentItem?.extractedFields?.caseNumber && (
            <span className="text-paper/75 font-mono">{interpolate(t.spCasePrefix, { number: currentItem.extractedFields.caseNumber })}</span>
          )}
        </div>

        {/* Keyboard shortcut badges */}
        <div className="hidden sm:flex items-center gap-3 text-paper/75 text-xs">
          <span className="flex items-center gap-1"><Keyboard className="w-3.5 h-3.5 text-paper/70" /> {t.spHotkeys}</span>
          <span><kbd className="bg-ink-2 px-1.5 py-0.5 rounded font-bold text-go-fill">A</kbd> {t.spKeyApprove}</span>
          <span><kbd className="bg-ink-2 px-1.5 py-0.5 rounded font-bold text-catch">R</kbd> {t.spKeyReject}</span>
          <span><kbd className="bg-ink-2 px-1.5 py-0.5 rounded font-bold text-signature">E</kbd> {t.spKeyEdit}</span>
          <span><kbd className="bg-ink-2 px-1.5 py-0.5 rounded font-bold text-paper">J/K</kbd> {t.spKeyNav}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Localized equivalents of aria-label="Previous Notice" and aria-label="Next Notice" */}
          <button
            onClick={handlePrev}
            disabled={safeIndex === 0}
            className="p-1 rounded hover:bg-ink-2 disabled:opacity-40 transition"
            aria-label={t.spPrevAria}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleNext}
            disabled={safeIndex >= items.length - 1}
            className="p-1 rounded hover:bg-ink-2 disabled:opacity-40 transition"
            aria-label={t.spNextAria}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Split Body */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-line overflow-hidden">
        {/* Left Pane: Raw Legal Notice Prose */}
        <div className="flex flex-col h-full bg-paper/50 overflow-hidden">
          <div className="p-3 bg-paper border-b border-line text-xs font-bold text-ink-2 flex justify-between items-center">
            <span>{t.spLeftHeading}</span>
            {safeExternalUrl(currentItem?.sourceUrl) && (
              <a
                href={safeExternalUrl(currentItem?.sourceUrl)!}
                target="_blank"
                rel="noreferrer"
                className="text-yours hover:underline text-xs"
              >
                {t.spOpenSource}
              </a>
            )}
          </div>
          <div className="flex-1 p-5 overflow-y-auto font-mono text-xs leading-relaxed text-ink whitespace-pre-wrap select-text">
            {!rawText ? (
              t.spNoRawText
            ) : canHighlight && activeSpan ? (
              <>
                {rawText.slice(0, activeSpan.start)}
                <mark className="bg-signature text-ink px-1 py-0.5 rounded font-bold ring-2 ring-ink/20">
                  {rawText.slice(activeSpan.start, activeSpan.end)}
                </mark>
                {rawText.slice(activeSpan.end)}
              </>
            ) : (
              rawText
            )}
          </div>
        </div>

        {/* Right Pane: Structured Fields & Verification */}
        <div className="flex flex-col h-full bg-card overflow-hidden">
          <div className="p-3 bg-paper border-b border-line text-xs font-bold text-ink-2 flex justify-between items-center">
            <span>{t.spRightHeading}</span>
            <div className="flex items-center gap-2">
              <span className={`text-label font-bold px-2 py-0.5 rounded ${confidence === null ? 'bg-paper text-ink-2 border border-line' : isHighConfidence ? 'bg-paper text-ink border border-line-strong' : 'bg-catch-wash text-catch-ink border border-catch/30'}`}>
                {confidence === null ? t.spPendingConfidence : interpolate(t.spConfidencePct, { pct: Math.round(confidence * 100) })}
              </span>
              <button
                onClick={() => setEditMode(!editMode)}
                className={`p-1 rounded transition text-xs flex items-center gap-1 ${editMode ? 'bg-yours-wash text-yours font-bold' : 'hover:bg-paper text-ink-2'}`}
              >
                <Edit2 className="w-3 h-3" />
                <span>{editMode ? t.spEditingBtn : t.spEditBtn}</span>
              </button>
            </div>
          </div>

          <div className="flex-1 p-5 overflow-y-auto space-y-4 text-xs">
            {/* Field: Case Number */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label htmlFor="split-edit-case-number" className="font-semibold text-ink-2">{t.spFieldCase}</label>
                {renderSpanBadge('caseNumber')}
              </div>
              {editMode ? (
                <input
                  type="text"
                  id="split-edit-case-number"
                  value={editedFields.caseNumber || ''}
                  onChange={(e) => setEditedFields({ ...editedFields, caseNumber: e.target.value })}
                  className="w-full border border-line-strong rounded-control bg-card px-2.5 py-1.5 font-mono text-xs"
                />
              ) : (
                <div className="p-2 rounded-control bg-paper border border-line font-mono text-ink">
                  {currentItem?.extractedFields?.caseNumber || '—'}
                </div>
              )}
            </div>

            {/* Field: Defendant */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label htmlFor="split-edit-defendant" className="font-semibold text-ink-2">{t.spFieldDefendant}</label>
                {renderSpanBadge('defendant')}
              </div>
              {editMode ? (
                <input
                  type="text"
                  id="split-edit-defendant"
                  value={editedFields.defendant || ''}
                  onChange={(e) => setEditedFields({ ...editedFields, defendant: e.target.value })}
                  className="w-full border border-line-strong rounded-control bg-card px-2.5 py-1.5 text-xs"
                />
              ) : (
                <div className="p-2 rounded-control bg-paper border border-line text-ink">
                  {currentItem?.extractedFields?.defendant || '—'}
                </div>
              )}
            </div>

            {/* Field: Plaintiff */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label htmlFor="split-edit-plaintiff" className="font-semibold text-ink-2">{t.spFieldPlaintiff}</label>
                {renderSpanBadge('plaintiff')}
              </div>
              {editMode ? (
                <input
                  type="text"
                  id="split-edit-plaintiff"
                  value={editedFields.plaintiff || ''}
                  onChange={(e) => setEditedFields({ ...editedFields, plaintiff: e.target.value })}
                  className="w-full border border-line-strong rounded-control bg-card px-2.5 py-1.5 text-xs"
                />
              ) : (
                <div className="p-2 rounded-control bg-paper border border-line text-ink">
                  {currentItem?.extractedFields?.plaintiff || '—'}
                </div>
              )}
            </div>

            {/* Field: Opening Bid & Judgment Amount */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between gap-1 mb-1">
                  <label htmlFor="split-edit-opening-bid" className="font-semibold text-ink-2">{t.spFieldOpeningBid}</label>
                  {renderSpanBadge('openingBid')}
                </div>
                {editMode ? (
                  <input
                    type="number"
                    id="split-edit-opening-bid"
                    value={editedFields.openingBid ?? ''}
                    onChange={(e) => setEditedFields({ ...editedFields, openingBid: e.target.value.trim() === '' ? undefined : Number(e.target.value) })}
                    className="w-full border border-line-strong rounded-control bg-card px-2.5 py-1.5 font-mono text-xs"
                  />
                ) : (
                  <div className="p-2 rounded-control bg-paper border border-line font-mono font-bold text-ink">
                    {currentItem?.extractedFields?.openingBid ? fmtMoney(currentItem.extractedFields.openingBid) : '—'}
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between gap-1 mb-1">
                  <label htmlFor="split-edit-judgment-amount" className="font-semibold text-ink-2">{t.spFieldJudgment}</label>
                  {renderSpanBadge('judgmentAmount')}
                </div>
                {editMode ? (
                  <input
                    type="number"
                    id="split-edit-judgment-amount"
                    value={editedFields.judgmentAmount ?? ''}
                    onChange={(e) => setEditedFields({ ...editedFields, judgmentAmount: e.target.value.trim() === '' ? undefined : Number(e.target.value) })}
                    className="w-full border border-line-strong rounded-control bg-card px-2.5 py-1.5 font-mono text-xs"
                  />
                ) : (
                  <div className="p-2 rounded-control bg-paper border border-line font-mono text-ink">
                    {currentItem?.extractedFields?.judgmentAmount ? fmtMoney(currentItem.extractedFields.judgmentAmount) : '—'}
                  </div>
                )}
              </div>
            </div>

            {/* Field: Sale Date & APN */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center justify-between gap-1 mb-1">
                  <label htmlFor="split-edit-sale-date" className="font-semibold text-ink-2">{t.spFieldSaleDate}</label>
                  {renderSpanBadge('saleDate')}
                </div>
                {editMode ? (
                  <input
                    type="text"
                    id="split-edit-sale-date"
                    value={editedFields.saleDate || ''}
                    onChange={(e) => setEditedFields({ ...editedFields, saleDate: e.target.value })}
                    className="w-full border border-line-strong rounded-control bg-card px-2.5 py-1.5 font-mono text-xs"
                  />
                ) : (
                  <div className="p-2 rounded-control bg-paper border border-line font-mono text-ink">
                    {currentItem?.extractedFields?.saleDate || '—'}
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between gap-1 mb-1">
                  <label htmlFor="split-edit-apn" className="font-semibold text-ink-2">{t.spFieldApn}</label>
                  {renderSpanBadge('apn')}
                </div>
                {editMode ? (
                  <input
                    type="text"
                    id="split-edit-apn"
                    value={editedFields.apn || ''}
                    onChange={(e) => setEditedFields({ ...editedFields, apn: e.target.value })}
                    className="w-full border border-line-strong rounded-control bg-card px-2.5 py-1.5 font-mono text-xs"
                  />
                ) : (
                  <div className="p-2 rounded-control bg-paper border border-line font-mono text-ink">
                    {currentItem?.extractedFields?.apn || '—'}
                  </div>
                )}
              </div>
            </div>

            {/* Field: Reviewer Note */}
            <div>
              <label htmlFor="split-pane-review-note" className="font-semibold text-ink-2 block mb-1">
                {t.spReviewNoteLabel}
              </label>
              <textarea
                id="split-pane-review-note"
                rows={2}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder={t.spReviewNotePlaceholder}
                className="w-full border border-line-strong rounded-control bg-card px-2.5 py-1.5 text-xs"
              />
              {validationError && <p role="alert" className="text-xs text-catch-ink mt-1 font-semibold">{validationError}</p>}
            </div>
          </div>

          {/* Action Decision Buttons */}
          <div className="p-4 bg-paper border-t border-line flex items-center justify-between gap-3">
            <button
              onClick={handleRejectCurrent}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-control border border-catch/30 bg-catch-wash text-catch-ink text-xs font-bold hover:bg-catch-wash/80 transition"
            >
              <X className="w-4 h-4 text-catch-ink" />
              <span>{t.spRejectActionBtn}</span>
            </button>

            <button
              onClick={handleApproveCurrent}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-control bg-go text-white text-xs font-bold hover:bg-go/90 transition shadow-sm"
            >
              <Check className="w-4 h-4" />
              <span>{t.spApproveActionBtn}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReviewSplitPane;
