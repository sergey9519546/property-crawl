'use client';
// acknowledged-orphan: Task 14 real-time dual-pane speed review interface for ambiguous legal notices.

import React, { useState, useEffect, useCallback } from 'react';
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
  };
  reviewStatus: 'pending' | 'approved' | 'rejected';
}

interface ReviewSplitPaneProps {
  items: DocumentReviewItem[];
  onApprove: (id: string, updatedFields?: any) => Promise<void> | void;
  onReject: (id: string) => Promise<void> | void;
  onUpdateFields?: (id: string, fields: any) => void;
}

export function ReviewSplitPane({
  items = [],
  onApprove,
  onReject,
  onUpdateFields
}: ReviewSplitPaneProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editedFields, setEditedFields] = useState<any>({});

  const currentItem = items[currentIndex];

  useEffect(() => {
    if (currentItem) {
      setEditedFields({ ...currentItem.extractedFields });
      setEditMode(false);
    }
  }, [currentIndex, currentItem]);

  const handleNext = useCallback(() => {
    if (currentIndex < items.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  }, [currentIndex, items.length]);

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

  const handleApproveCurrent = useCallback(async () => {
    if (!currentItem) return;
    await onApprove(currentItem.id, editMode ? editedFields : currentItem.extractedFields);
    handleNext();
  }, [currentItem, editMode, editedFields, onApprove, handleNext]);

  const handleRejectCurrent = useCallback(async () => {
    if (!currentItem) return;
    await onReject(currentItem.id);
    handleNext();
  }, [currentItem, onReject, handleNext]);

  // Keyboard shortcut handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't trigger if operator is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'a':
          e.preventDefault();
          handleApproveCurrent();
          break;
        case 'r':
          e.preventDefault();
          handleRejectCurrent();
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
        default:
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleApproveCurrent, handleRejectCurrent, handleNext, handlePrev]);

  if (!items || items.length === 0) {
    return (
      <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
        <FileText className="w-8 h-8 mx-auto text-slate-400 mb-2" />
        <p className="font-semibold text-slate-700">No documents in review queue.</p>
        <p className="text-xs text-slate-400">All captured legal notices have been processed.</p>
      </div>
    );
  }

  const confidence = currentItem?.extractedFields?.confidenceScore ?? 0.85;
  const isHighConfidence = confidence >= 0.8;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[750px]">
      {/* Top Navigation & Shortcut Legend */}
      <div className="bg-slate-900 text-white px-5 py-3 flex items-center justify-between text-xs border-b border-slate-800">
        <div className="flex items-center gap-3">
          <span className="font-bold tracking-tight">Review Split-Pane</span>
          <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono text-[11px]">
            {currentIndex + 1} of {items.length}
          </span>
          {currentItem?.extractedFields?.caseNumber && (
            <span className="text-slate-400 font-mono">Case: {currentItem.extractedFields.caseNumber}</span>
          )}
        </div>

        {/* Keyboard shortcut badges */}
        <div className="hidden sm:flex items-center gap-3 text-slate-400 text-[11px]">
          <span className="flex items-center gap-1"><Keyboard className="w-3.5 h-3.5 text-slate-500" /> Hotkeys:</span>
          <span><kbd className="bg-slate-800 px-1.5 py-0.5 rounded font-bold text-emerald-400">A</kbd> Approve</span>
          <span><kbd className="bg-slate-800 px-1.5 py-0.5 rounded font-bold text-rose-400">R</kbd> Reject</span>
          <span><kbd className="bg-slate-800 px-1.5 py-0.5 rounded font-bold text-sky-400">E</kbd> Edit</span>
          <span><kbd className="bg-slate-800 px-1.5 py-0.5 rounded font-bold text-slate-300">J/K</kbd> Next/Prev</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handlePrev}
            disabled={currentIndex === 0}
            className="p-1 rounded hover:bg-slate-800 disabled:opacity-40 transition"
            aria-label="Previous Notice"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleNext}
            disabled={currentIndex >= items.length - 1}
            className="p-1 rounded hover:bg-slate-800 disabled:opacity-40 transition"
            aria-label="Next Notice"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Split Body */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200 overflow-hidden">
        {/* Left Pane: Raw Legal Notice Prose */}
        <div className="flex flex-col h-full bg-slate-50/50 overflow-hidden">
          <div className="p-3 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-600 flex justify-between items-center">
            <span>RAW LEGAL NOTICE PROSE</span>
            {currentItem?.sourceUrl && (
              <a
                href={currentItem.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sky-600 hover:underline text-[11px]"
              >
                Open Source
              </a>
            )}
          </div>
          <div className="flex-1 p-5 overflow-y-auto font-mono text-xs leading-relaxed text-slate-800 whitespace-pre-wrap select-text">
            {currentItem?.rawText || 'No raw document text available.'}
          </div>
        </div>

        {/* Right Pane: Structured Fields & Verification */}
        <div className="flex flex-col h-full bg-white overflow-hidden">
          <div className="p-3 bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-600 flex justify-between items-center">
            <span>STRUCTURED EXTRACTED FIELDS</span>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${isHighConfidence ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {Math.round(confidence * 100)}% Confidence
              </span>
              <button
                onClick={() => setEditMode(!editMode)}
                className={`p-1 rounded transition text-xs flex items-center gap-1 ${editMode ? 'bg-sky-100 text-sky-800 font-bold' : 'hover:bg-slate-200 text-slate-600'}`}
              >
                <Edit2 className="w-3 h-3" />
                <span>{editMode ? 'Editing' : 'Edit'}</span>
              </button>
            </div>
          </div>

          <div className="flex-1 p-5 overflow-y-auto space-y-4 text-xs">
            {/* Field: Case Number */}
            <div>
              <label className="font-semibold text-slate-600 block mb-1">Case / Docket Number</label>
              {editMode ? (
                <input
                  type="text"
                  value={editedFields.caseNumber || ''}
                  onChange={(e) => setEditedFields({ ...editedFields, caseNumber: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 font-mono text-xs"
                />
              ) : (
                <div className="p-2 rounded bg-slate-50 border border-slate-200 font-mono text-slate-900">
                  {currentItem?.extractedFields?.caseNumber || '—'}
                </div>
              )}
            </div>

            {/* Field: Defendant */}
            <div>
              <label className="font-semibold text-slate-600 block mb-1">Defendant (Owner / Heirs)</label>
              {editMode ? (
                <input
                  type="text"
                  value={editedFields.defendant || ''}
                  onChange={(e) => setEditedFields({ ...editedFields, defendant: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-xs"
                />
              ) : (
                <div className="p-2 rounded bg-slate-50 border border-slate-200 text-slate-900">
                  {currentItem?.extractedFields?.defendant || '—'}
                </div>
              )}
            </div>

            {/* Field: Plaintiff */}
            <div>
              <label className="font-semibold text-slate-600 block mb-1">Plaintiff (Foreclosing Lender)</label>
              {editMode ? (
                <input
                  type="text"
                  value={editedFields.plaintiff || ''}
                  onChange={(e) => setEditedFields({ ...editedFields, plaintiff: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-xs"
                />
              ) : (
                <div className="p-2 rounded bg-slate-50 border border-slate-200 text-slate-900">
                  {currentItem?.extractedFields?.plaintiff || '—'}
                </div>
              )}
            </div>

            {/* Field: Opening Bid & Judgment Amount */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-slate-600 block mb-1">Opening Bid ($)</label>
                {editMode ? (
                  <input
                    type="number"
                    value={editedFields.openingBid ?? ''}
                    onChange={(e) => setEditedFields({ ...editedFields, openingBid: Number(e.target.value) })}
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 font-mono text-xs"
                  />
                ) : (
                  <div className="p-2 rounded bg-slate-50 border border-slate-200 font-mono font-bold text-slate-900">
                    {currentItem?.extractedFields?.openingBid ? `$${currentItem.extractedFields.openingBid.toLocaleString()}` : '—'}
                  </div>
                )}
              </div>
              <div>
                <label className="font-semibold text-slate-600 block mb-1">Judgment Amount ($)</label>
                {editMode ? (
                  <input
                    type="number"
                    value={editedFields.judgmentAmount ?? ''}
                    onChange={(e) => setEditedFields({ ...editedFields, judgmentAmount: Number(e.target.value) })}
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 font-mono text-xs"
                  />
                ) : (
                  <div className="p-2 rounded bg-slate-50 border border-slate-200 font-mono text-slate-900">
                    {currentItem?.extractedFields?.judgmentAmount ? `$${currentItem.extractedFields.judgmentAmount.toLocaleString()}` : '—'}
                  </div>
                )}
              </div>
            </div>

            {/* Field: Sale Date & APN */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-semibold text-slate-600 block mb-1">Auction Sale Date</label>
                {editMode ? (
                  <input
                    type="text"
                    value={editedFields.saleDate || ''}
                    onChange={(e) => setEditedFields({ ...editedFields, saleDate: e.target.value })}
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 font-mono text-xs"
                  />
                ) : (
                  <div className="p-2 rounded bg-slate-50 border border-slate-200 font-mono text-slate-900">
                    {currentItem?.extractedFields?.saleDate || '—'}
                  </div>
                )}
              </div>
              <div>
                <label className="font-semibold text-slate-600 block mb-1">APN / Parcel ID</label>
                {editMode ? (
                  <input
                    type="text"
                    value={editedFields.apn || ''}
                    onChange={(e) => setEditedFields({ ...editedFields, apn: e.target.value })}
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 font-mono text-xs"
                  />
                ) : (
                  <div className="p-2 rounded bg-slate-50 border border-slate-200 font-mono text-slate-900">
                    {currentItem?.extractedFields?.apn || '—'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action Decision Buttons */}
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
            <button
              onClick={handleRejectCurrent}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs font-bold hover:bg-rose-100 transition"
            >
              <X className="w-4 h-4 text-rose-600" />
              <span>Reject Notice [R]</span>
            </button>

            <button
              onClick={handleApproveCurrent}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition shadow-sm"
            >
              <Check className="w-4 h-4" />
              <span>Approve & Publish [A]</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ReviewSplitPane;
