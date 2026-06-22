import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// No StrictMode: it double-invokes effects/renders in dev, which would
// double-seed the engine.
createRoot(document.getElementById('root')).render(<App />)
