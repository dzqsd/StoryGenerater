import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '60vh', padding: 40, textAlign: 'center',
        }}>
          <h2 style={{ color: '#5A628F', marginBottom: 16, fontFamily: 'Archivo, sans-serif' }}>
            出错了
          </h2>
          <p style={{ color: '#7A7A7A', marginBottom: 12, fontSize: 14 }}>
            {this.state.error.message || '发生了未知错误'}
          </p>
          <button
            className="btn btn-primary"
            onClick={() => {
              this.setState({ error: null })
              window.location.href = '#/'
            }}
          >
            返回首页
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
