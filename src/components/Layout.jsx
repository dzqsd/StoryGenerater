import { NavLink } from 'react-router-dom'

const navItems = [
  { to: '/', label: '创作', icon: '📝' },
  { to: '/settings', label: '设置', icon: '⚙️' },
]

export default function Layout({ children }) {
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-title">📖 小说工坊</div>
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                'sidebar-link' + (isActive ? ' active' : '')
              }
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  )
}
