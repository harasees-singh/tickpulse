import { render } from 'solid-js/web'
import App from './ui/App'
import { flushSettings } from './core/settings'
import { initTheme } from './core/theme'
import './styles.css'

// Apply the saved theme (Obsidian/Daylight) + seed the canvas palette before the
// first render, and keep both in sync with settings thereafter.
initTheme()

// Persist any debounced settings write before the tab unloads.
window.addEventListener('beforeunload', flushSettings)

render(() => <App />, document.getElementById('root')!)