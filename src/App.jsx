import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import ProjectListPage from './pages/ProjectListPage'
import ProjectDashboard from './pages/ProjectDashboard'
import ChatPage from './pages/ChatPage'
import WritePage from './pages/WritePage'
import ReadPage from './pages/ReadPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ProjectListPage />} />
        <Route path="/project/:id" element={<ProjectDashboard />} />
        <Route path="/project/:id/write" element={<WritePage />} />
        <Route path="/project/:id/read" element={<ReadPage />} />
        <Route path="/settings" element={<SettingsPage />} />

        {/* Planning modules */}
        <Route path="/project/:id/chat" element={<Navigate to="../world" replace />} />
        <Route path="/project/:id/world" element={<ChatPage key="world" mode="world" />} />
        <Route path="/project/:id/characters" element={<ChatPage key="characters" mode="characters" />} />
        <Route path="/project/:id/plot" element={<ChatPage key="plot" mode="plot" />} />
        <Route path="/project/:id/outline" element={<ChatPage key="outline" mode="outline" />} />
        <Route path="/project/:id/revision" element={<ChatPage key="revision" mode="revision" />} />
      </Routes>
    </Layout>
  )
}
