import React from 'react';
import { motion } from 'framer-motion';

interface AnimatedCheckmarkProps {
  isChecked: boolean;
  className?: string;
}

export default function AnimatedCheckmark({ isChecked, className }: AnimatedCheckmarkProps) {
  return (
    <svg 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="3.5" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <motion.path
        d="M20 6L9 17L4 12"
        initial={false}
        animate={{ 
          pathLength: isChecked ? 1 : 0,
          opacity: isChecked ? 1 : 0,
          scale: isChecked ? [0.8, 1.1, 1] : 0.8
        }}
        transition={{ 
          duration: 0.3, 
          ease: [0.16, 1, 0.3, 1],
          opacity: { duration: 0.1 }
        }}
      />
    </svg>
  );
}
