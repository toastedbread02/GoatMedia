import { useEffect, useId, useRef, useState } from 'react';
import type { IconName } from './Icon';
import { Icon } from './Icon';

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

interface MenuProps {
  items: MenuItem[];
  label?: string;
  icon?: IconName;
  align?: 'start' | 'end';
  className?: string;
}

export function Menu({ items, label = 'More options', icon = 'more', align = 'end', className = '' }: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const visible = items.filter((item) => !item.disabled);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      const first = wrapper.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
      first?.focus();
    }
  }, [open]);

  return (
    <div className={`menu ${className}`} ref={wrapper} data-open={open}>
      <button
        ref={trigger}
        type="button"
        className="icon-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={icon} />
      </button>
      {open ? (
        <div
          className={`menu__panel menu__panel--${align}`}
          role="menu"
          id={menuId}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const nodes = Array.from(
              wrapper.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || [],
            );
            const current = nodes.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === 'ArrowDown'
                ? nodes[(current + 1) % nodes.length]
                : nodes[(current - 1 + nodes.length) % nodes.length];
            next?.focus();
          }}
        >
          {visible.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`menu__item ${item.tone === 'danger' ? 'menu__item--danger' : ''}`}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon ? <Icon name={item.icon} size={18} /> : null}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
