import { Routes, Route } from 'react-router-dom'
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
        <Route path="/project/:id/chat" element={<ChatPage />} />
        <Route path="/project/:id/write" element={<WritePage />} />
        <Route path="/project/:id/read" element={<ReadPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Layout>
  )
}
