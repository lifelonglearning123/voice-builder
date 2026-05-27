'use client';

import { useEffect, useRef, type CSSProperties, type ElementType, type ReactNode } from 'react';

// Scroll-triggered fade-up wrapper. Adds `.is-visible` to the element on
// first viewport entry, then disconnects (one-shot animation).
//
// Apply to any element you want to lift in on scroll. Wrap groups of children
// in `<RevealGroup>` if you want them to cascade in sequence.

interface RevealProps {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  delayMs?: number;
}

export function Reveal({
  children,
  as = 'div',
  className = '',
  style,
  delayMs,
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add('is-visible');
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Tag = as as 'div';
  const inlineStyle: CSSProperties = {
    ...style,
    ...(delayMs ? { transitionDelay: `${delayMs}ms` } : {}),
  };
  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      className={`reveal ${className}`}
      style={inlineStyle}
    >
      {children}
    </Tag>
  );
}

interface RevealGroupProps {
  children: ReactNode;
  className?: string;
  as?: ElementType;
}

export function RevealGroup({ children, className = '', as = 'div' }: RevealGroupProps) {
  const Tag = as as 'div';
  return <Tag className={`reveal-stagger ${className}`}>{children}</Tag>;
}
