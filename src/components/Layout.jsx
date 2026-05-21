import { NavLink, useLocation } from 'react-router-dom'

const globalNav = [
  { to: '/', label: '我的作品', end: true },
  { to: '/settings', label: '设置', end: false },
]

const projectNav = [
  { to: 'general', label: '总策划' },
  { to: 'world', label: '世界观' },
  { to: 'characters', label: '人物' },
  { to: 'plot', label: '剧情' },
  { to: 'outline', label: '章节' },
  { to: 'revision', label: '修订' },
]

const toolsNav = [
  { to: 'write', label: '写作', primary: true },
  { to: 'read', label: '阅读', primary: false },
]

export default function Layout({ children }) {
  const location = useLocation()
  const inProject = location.pathname.startsWith('/project/')
  const id = inProject ? location.pathname.split('/')[2] : null

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-title">
          <NavLink to="/" style={{ color: 'inherit', textDecoration: 'none' }}>
            Story Generator
          </NavLink>
        </div>
        <nav className="sidebar-nav">
          {inProject ? (
            <>
              <NavLink
                to={`/project/${id}`}
                end
                className={({ isActive }) =>
                  'sidebar-link' + (isActive ? ' active' : '')
                }
              >
                <span>项目总览</span>
              </NavLink>
              <div className="sidebar-section-label">策划模块</div>
              {projectNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={`/project/${id}/${item.to}`}
                  className={({ isActive }) =>
                    'sidebar-link' + (isActive ? ' active' : '')
                  }
                >
                  <span>{item.label}</span>
                </NavLink>
              ))}
              <div className="sidebar-section-label">创作工具</div>
              <div className="sidebar-tools-group">
                {toolsNav.map((item) => (
                  <NavLink
                    key={item.to}
                    to={`/project/${id}/${item.to}`}
                    className={({ isActive }) =>
                      'sidebar-action-link' +
                      (item.primary ? ' primary' : '') +
                      (isActive ? ' active' : '')
                    }
                  >
                    <span className={`sidebar-action-dot ${item.to}`} />
                    <span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
              <div className="sidebar-divider" />
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  'sidebar-link' + (isActive ? ' active' : '')
                }
              >
                <span>← 返回作品列表</span>
              </NavLink>
            </>
          ) : (
            globalNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  'sidebar-link' + (isActive ? ' active' : '')
                }
              >
                <span>{item.label}</span>
              </NavLink>
            ))
          )}
        </nav>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  )
}
