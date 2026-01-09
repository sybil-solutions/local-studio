'use client';

import { motion } from 'framer-motion';

interface TypingIndicatorProps {
  size?: 'sm' | 'md' | 'lg';
  color?: string;
}

export function TypingIndicator({ size = 'md', color = 'var(--foreground)' }: TypingIndicatorProps) {
  const sizeClasses = {
    sm: 'scale-75 gap-1',
    md: 'scale-100 gap-1.5',
    lg: 'scale-125 gap-2',
  };

  const dotSize = {
    sm: 6,
    md: 8,
    lg: 10,
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -5 }}
      transition={{ duration: 0.2 }}
      className={`flex items-center ${sizeClasses[size]}`}
      style={{ color }}
    >
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="rounded-full bg-current"
          style={{
            width: dotSize[size],
            height: dotSize[size],
          }}
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.5, 1, 0.5],
          }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.15,
            ease: 'easeInOut',
          }}
        />
      ))}
    </motion.div>
  );
}

interface StreamingCursorProps {
  color?: string;
}

export function StreamingCursor({ color = 'var(--foreground)' }: StreamingCursorProps) {
  return (
    <motion.span
      className="inline-block w-0.5 h-4 ml-0.5 rounded-sm"
      style={{ backgroundColor: color }}
      animate={{
        opacity: [1, 0],
      }}
      transition={{
        duration: 0.8,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    />
  );
}
