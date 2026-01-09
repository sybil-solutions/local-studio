'use client';

import { useState } from 'react';
import { Bookmark, BookmarkCheck, ThumbsUp, ThumbsDown, Copy, Check, MoreVertical } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface MessageActionsProps {
  content: string;
  messageId: string;
  onBookmark?: (messageId: string, bookmarked: boolean) => void;
  onReact?: (messageId: string, reaction: 'up' | 'down' | null) => void;
}

interface Reaction {
  type: 'up' | 'down' | null;
  count: number;
}

export function MessageActions({ content, messageId, onBookmark, onReact }: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const [showMenu, setShowMenu] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleBookmark = () => {
    const newState = !bookmarked;
    setBookmarked(newState);
    onBookmark?.(messageId, newState);
  };

  const handleReaction = (type: 'up' | 'down') => {
    const newReaction = reaction?.type === type ? null : { type, count: (reaction?.type === type ? reaction.count - 1 : reaction?.count || 0) + 1 };
    setReaction(newReaction);
    onReact?.(messageId, newReaction?.type || null);
  };

  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
      {/* Bookmark */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleBookmark}
        className="p-1.5 rounded-lg hover:bg-[var(--accent)] transition-all duration-200 text-[#9a9590] hover:text-[var(--warning)]"
        title={bookmarked ? 'Remove bookmark' : 'Bookmark message'}
      >
        <AnimatePresence mode="wait">
          {bookmarked ? (
            <motion.div
              key="bookmarked"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            >
              <BookmarkCheck className="h-3.5 w-3.5 text-[var(--warning)]" />
            </motion.div>
          ) : (
            <motion.div
              key="bookmark"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            >
              <Bookmark className="h-3.5 w-3.5" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Thumbs Up */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => handleReaction('up')}
        className={`p-1.5 rounded-lg hover:bg-[var(--accent)] transition-all duration-200 ${
          reaction?.type === 'up' ? 'text-[var(--success)] bg-[var(--accent)]' : 'text-[#9a9590]'
        }`}
        title="Helpful"
      >
        <ThumbsUp className="h-3.5 w-3.5" />
        {reaction?.type === 'up' && reaction.count > 1 && (
          <span className="ml-1 text-xs font-medium">{reaction.count}</span>
        )}
      </motion.button>

      {/* Thumbs Down */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => handleReaction('down')}
        className={`p-1.5 rounded-lg hover:bg-[var(--accent)] transition-all duration-200 ${
          reaction?.type === 'down' ? 'text-[var(--destructive)] bg-[var(--accent)]' : 'text-[#9a9590]'
        }`}
        title="Not helpful"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
        {reaction?.type === 'down' && reaction.count > 1 && (
          <span className="ml-1 text-xs font-medium">{reaction.count}</span>
        )}
      </motion.button>

      {/* Copy */}
      <motion.button
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleCopy}
        className="p-1.5 rounded-lg hover:bg-[var(--accent)] transition-all duration-200 text-[#9a9590]"
        title="Copy message"
      >
        <AnimatePresence mode="wait">
          {copied ? (
            <motion.div
              key="copied"
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, rotate: 180 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            >
              <Check className="h-3.5 w-3.5 text-[var(--success)]" />
            </motion.div>
          ) : (
            <motion.div
              key="copy"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            >
              <Copy className="h-3.5 w-3.5" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}
