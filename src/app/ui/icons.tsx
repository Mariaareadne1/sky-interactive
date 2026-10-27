// Small line icons, drawn for this UI at 20px on a 20-unit grid.

interface IconProps {
  name: IconName;
}

export type IconName =
  | 'draw' | 'undo' | 'redo' | 'camera' | 'help' | 'menu' | 'trash' | 'fly' | 'loop';

const paths: Record<IconName, string> = {
  draw: 'M4 15.5c2.5-.2 3.6-2.8 5.6-6.2C11.2 6.6 13 4.6 15.6 4.5M13.4 4.4l2.4.1-.2 2.3',
  undo: 'M7.5 6.5 4 10l3.5 3.5M4.5 10H12a4 4 0 0 1 0 8h-1',
  redo: 'M12.5 6.5 16 10l-3.5 3.5M15.5 10H8a4 4 0 0 0 0 8h1',
  camera: 'M3.5 7.5h3l1.3-2h4.4l1.3 2h3v8h-13zM10 13.6a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6',
  help: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15M7.9 7.8a2.2 2.2 0 1 1 3 2c-.6.3-.9.8-.9 1.4v.5M10 14.2v.1',
  menu: 'M4.5 10h.1M10 10h.1M15.5 10h.1',
  trash: 'M4.5 6h11M8 6V4.5h4V6M6 6l.7 10h6.6L14 6',
  // a paper dart, and a loop with an arrow
  fly: 'M3 10.5 17 4l-4.6 12-2.6-4.2zM9.8 11.8 17 4',
  loop: 'M3 15.5c3 0 5.2-1.2 6.4-3.6a3.6 3.6 0 1 0-3.3-1.4c1.4 2.8 4.7 5 10.4 5M14.3 13.3l2.2 2.2-2.2 2.2',
};

export function Icon({ name }: IconProps) {
  return (
    <svg className="icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d={paths[name]} fill="none" stroke="currentColor" strokeWidth={name === 'menu' ? 2.6 : 1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
