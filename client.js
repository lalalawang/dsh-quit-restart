/**
 * Client half of dsh-quit-restart.
 *
 * The window caption belongs to the Electron shell and the "…" menu next to it
 * is native, so a Web plugin cannot add items there. The entry therefore uses
 * the sidebar footer seat (`sidebar.footer.action`): the layout owns the
 * position, nothing overlaps the native controls, and the row is visible in
 * every view.
 */
window.__ModuleLoader__.load({
  id: 'dsh-quit-restart',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState } = React

    const STATUS = '/api/quit-restart/status'
    const RESTART = '/api/quit-restart/restart'
    const zh =
      typeof navigator === 'object' &&
      typeof navigator.language === 'string' &&
      navigator.language.toLowerCase().startsWith('zh')
    const TEXT = zh
      ? { label: '退出并重启 DSH', busy: '正在退出…', failed: '重启失败' }
      : { label: 'Quit and restart DSH', busy: 'Quitting…', failed: 'Restart failed' }

    const styles = {
      row: { display: 'flex', alignItems: 'center', width: '100%', minWidth: 0, padding: '0 2px' },
      button: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        minWidth: 0,
        height: '30px',
        padding: '0 8px',
        border: '1px solid transparent',
        borderRadius: '8px',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, currentColor)',
        fontFamily: 'inherit',
        fontSize: '12px',
        lineHeight: '18px',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'background 120ms ease, color 120ms ease',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis'
      },
      buttonBusy: { opacity: 0.6, cursor: 'progress' },
      glyph: { display: 'block', flex: '0 0 auto' },
      label: { overflow: 'hidden', textOverflow: 'ellipsis' }
    }

    function Glyph() {
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, style: styles.glyph },
        h('path', {
          d: 'M8 2.5a5.5 5.5 0 1 1-5.2 3.7',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round'
        }),
        h('path', {
          d: 'M2.2 2.2v3.6h3.6',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round'
        })
      )
    }

    function QuitRestartButton() {
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState('')
      const alive = useRef(true)

      useEffect(() => {
        alive.current = true
        fetch(STATUS).catch(() => {})
        return () => {
          alive.current = false
        }
      }, [])

      async function quitAndRestart() {
        if (busy) return
        setBusy(true)
        setNote(TEXT.busy)
        try {
          const response = await fetch(RESTART, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ dryRun: false })
          })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok || payload.ok !== true) {
            if (!alive.current) return
            setBusy(false)
            setNote(payload.error || TEXT.failed)
            return
          }
          setNote(TEXT.busy)
        } catch (error) {
          if (!alive.current) return
          setBusy(false)
          setNote(TEXT.failed + ': ' + (error && error.message ? error.message : String(error)))
        }
      }

      const text = busy || note !== '' ? note || TEXT.busy : TEXT.label

      return h(
        'div',
        { style: styles.row },
        h(
          'button',
          {
            type: 'button',
            'aria-label': TEXT.label,
            title: TEXT.label,
            onClick: quitAndRestart,
            disabled: busy,
            style: busy ? { ...styles.button, ...styles.buttonBusy } : styles.button,
            onMouseEnter: event => {
              event.currentTarget.style.background = 'var(--dsw-alias-bg-l3, rgba(127, 127, 127, 0.18))'
              event.currentTarget.style.color = 'var(--dsw-alias-label-primary, currentColor)'
            },
            onMouseLeave: event => {
              event.currentTarget.style.background = 'transparent'
              event.currentTarget.style.color = 'var(--dsw-alias-label-secondary, currentColor)'
            }
          },
          h(Glyph, null),
          h('span', { style: styles.label }, text)
        )
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            { name: 'sidebar.footer.action', id: 'quit-restart', order: 5 },
            QuitRestartButton
          )
        )
      }
    }
  }
})
