import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ProfileRestoreLauncher from './ProfileRestoreLauncher'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App/><ProfileRestoreLauncher/></React.StrictMode>,
)
