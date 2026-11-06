import {
  cloneElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

type Placement = 'below-end' | 'below-start' | 'above-start' | 'right-start';

interface PopoverProps {
  trigger: ReactElement<{
    onClick?: (event: React.MouseEvent) => void;
    'aria-expanded'?: boolean;
    'aria-haspopup'?: boolean | 'menu' | 'dialog';
  }>;
  children: (close: () => void) => ReactNode;
  label: string;
  placement?: Placement;
  className?: string;
}

export function Popover({ trigger, children, label, placement = 'below-end', className = '' }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);

  const close = () => {
    if (!open) return;
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 140);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        const focusTarget = anchor.current?.querySelector<HTMLElement>('button, [href], input');
        focusTarget?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const triggerElement = cloneElement(trigger, {
    onClick: (event: React.MouseEvent) => {
      trigger.props.onClick?.(event);
      if (open) close();
      else setOpen(true);
    },
    'aria-expanded': open,
    'aria-haspopup': 'menu',
  });

  return (
    <span className="popover-anchor" ref={anchor}>
      {triggerElement}
      {open ? (
        <div
          className={`popover popover--${placement}${closing ? ' is-closing' : ''} ${className}`}
          role="menu"
          aria-label={label}
        >
          {children(close)}
        </div>
      ) : null}
    </span>
  );
}
