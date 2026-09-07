<script lang="ts" module>
  /**
   * Inline icons, one path each.
   *
   * Inline rather than an icon font or sprite sheet: the renderer's CSP is
   * `default-src 'self'`, and a 24-line map costs less than a dependency.
   */
  export const ICONS = {
    select: 'M4 3l14 7-6 2-2 6z',
    box: 'M4 5h16v14H4z',
    polygon: 'M12 3l8 5-3 12H7L4 8z',
    pan: 'M8 12V5a2 2 0 114 0v6m0-2a2 2 0 114 0v2m0-1a2 2 0 114 0v5a6 6 0 01-6 6h-2a6 6 0 01-6-6v-3a2 2 0 114 0',
    eraser: 'M9 20H6l-2.5-2.5a2 2 0 010-2.8L14 4.2a2 2 0 012.8 0l3.5 3.5a2 2 0 010 2.8L11.5 20H9zM8 10l6 6M4 20h16',
    zoomIn: 'M11 4a7 7 0 100 14 7 7 0 000-14zm0 4v6m-3-3h6m5 8l-4-4',
    zoomOut: 'M11 4a7 7 0 100 14 7 7 0 000-14zM8 11h6m5 8l-4-4',
    fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    actual: 'M4 4h16v16H4z M9 9h6v6H9z',
    previous: 'M15 5l-7 7 7 7',
    next: 'M9 5l7 7-7 7',
    save: 'M5 4h11l3 3v13H5zM8 4v6h7V4M8 20v-6h8v6',
    trash: 'M4 7h16M9 7V5h6v2m-8 0l1 13h8l1-13',
    predict: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z',
    check: 'M4 12l5 5L20 6',
    folder: 'M4 6h6l2 2h8v10H4z',
    refresh: 'M20 12a8 8 0 11-2.3-5.7M20 4v5h-5',
    settings: 'M12 9a3 3 0 100 6 3 3 0 000-6z M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5v.2a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1h.2a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z',
    dataset: 'M4 6c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2z M4 6v12c0 1.1 3.6 2 8 2s8-.9 8-2V6 M4 12c0 1.1 3.6 2 8 2s8-.9 8-2',
    train: 'M4 19V9l8-5 8 5v10 M9 19v-6h6v6',
    play: 'M7 4l12 8-12 8z',
    stop: 'M6 6h12v12H6z',
    plus: 'M12 5v14M5 12h14',
    close: 'M6 6l12 12M18 6L6 18',
    undo: 'M9 14L4 9l5-5 M4 9h10a6 6 0 010 12h-4',
    redo: 'M15 14l5-5-5-5 M20 9H10a6 6 0 000 12h4',
    warning: 'M12 4l9 16H3zM12 10v4m0 3v.5',
    background: 'M4 5h16v14H4z M4 15l5-5 4 4 3-3 4 4'
  } as const

  export type IconName = keyof typeof ICONS
</script>

<script lang="ts">
  interface Props {
    name: IconName
    size?: number
  }

  const { name, size = 18 }: Props = $props()
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={ICONS[name]} />
</svg>

<style>
  svg {
    flex: none;
  }
</style>
