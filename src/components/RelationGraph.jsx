import { useRef, useEffect, useState, useCallback } from 'react'
import { computeForceLayout } from '../utils/forceLayout'

const RELATION_COLORS = {
  '师徒': '#6B74A8',
  '敌对': '#C48888',
  '爱慕': '#D4A5A5',
  '亲子': '#8BA87D',
  '朋友': '#A8B86B',
  '盟友': '#6BA8A0',
  '上下级': '#B0A090',
  '其他': '#9A9A9A',
}

const NODE_RADIUS = 30

export default function RelationGraph({ characters, relations, width: propWidth, height: propHeight }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const [hoveredNode, setHoveredNode] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [size, setSize] = useState({ width: propWidth || 600, height: propHeight || 400 })

  // Observe container size
  useEffect(() => {
    if (propWidth && propHeight) {
      setSize({ width: propWidth, height: propHeight })
      return
    }
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setSize({ width, height })
        }
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [propWidth, propHeight])

  const { width, height } = size

  // Build graph data
  useEffect(() => {
    const newNodes = characters.map((c) => ({
      id: c.id,
      label: c.name,
      role: c.role,
    }))
    const newEdges = relations.map((r) => ({
      from: r.fromCharId,
      to: r.toCharId,
      type: r.type,
      description: r.description,
    }))
    computeForceLayout(newNodes, newEdges, { width, height })
    setNodes(newNodes)
    setEdges(newEdges)
  }, [characters, relations, width, height])

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.clearRect(0, 0, width, height)
    ctx.save()
    ctx.translate(offset.x, offset.y)
    ctx.scale(scale, scale)

    // Draw edges
    for (const edge of edges) {
      const fromNode = nodes.find((n) => n.id === edge.from)
      const toNode = nodes.find((n) => n.id === edge.to)
      if (!fromNode || !toNode) continue

      const highlight = hoveredNode && (hoveredNode.id === edge.from || hoveredNode.id === edge.to)
      ctx.strokeStyle = highlight ? RELATION_COLORS[edge.type] || '#9A9A9A' : 'rgba(154,154,154,0.3)'
      ctx.lineWidth = highlight ? 2 : 1
      ctx.beginPath()
      ctx.moveTo(fromNode.x, fromNode.y)
      ctx.lineTo(toNode.x, toNode.y)
      ctx.stroke()

      // Arrow
      const angle = Math.atan2(toNode.y - fromNode.y, toNode.x - fromNode.x)
      const arrowX = toNode.x - Math.cos(angle) * NODE_RADIUS
      const arrowY = toNode.y - Math.sin(angle) * NODE_RADIUS
      const arrowLen = 8
      ctx.fillStyle = ctx.strokeStyle
      ctx.beginPath()
      ctx.moveTo(arrowX, arrowY)
      ctx.lineTo(
        arrowX - arrowLen * Math.cos(angle - 0.5),
        arrowY - arrowLen * Math.sin(angle - 0.5)
      )
      ctx.lineTo(
        arrowX - arrowLen * Math.cos(angle + 0.5),
        arrowY - arrowLen * Math.sin(angle + 0.5)
      )
      ctx.closePath()
      ctx.fill()

      // Edge label at midpoint
      const mx = (fromNode.x + toNode.x) / 2
      const my = (fromNode.y + toNode.y) / 2
      ctx.fillStyle = '#9A9A9A'
      ctx.font = '11px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(edge.type, mx, my - 6)
    }

    // Draw nodes
    for (const node of nodes) {
      const isHovered = hoveredNode?.id === node.id
      ctx.fillStyle = isHovered ? '#6B74A8' : '#D1DEE5'
      ctx.strokeStyle = isHovered ? '#5A628F' : '#C5D4DD'
      ctx.lineWidth = isHovered ? 2.5 : 1.5
      ctx.beginPath()
      ctx.arc(node.x, node.y, NODE_RADIUS, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      // Label
      ctx.fillStyle = isHovered ? '#FFFFFF' : '#4A4A4A'
      ctx.font = '12px "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(node.label, node.x, node.y)
    }

    ctx.restore()
  }, [nodes, edges, hoveredNode, scale, offset, width, height])

  // Mouse handlers
  const getMousePos = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left - offset.x) / scale,
      y: (e.clientY - rect.top - offset.y) / scale,
    }
  }, [scale, offset])

  const handleMouseDown = useCallback((e) => {
    const pos = getMousePos(e)
    const hit = nodes.find((n) => {
      const dx = n.x - pos.x
      const dy = n.y - pos.y
      return Math.sqrt(dx * dx + dy * dy) < NODE_RADIUS + 4
    })
    if (hit) {
      setDragging({ node: hit, startX: pos.x - hit.x, startY: pos.y - hit.y })
    }
  }, [nodes, getMousePos])

  const handleMouseMove = useCallback((e) => {
    const pos = getMousePos(e)
    if (dragging) {
      setNodes((prev) =>
        prev.map((n) =>
          n.id === dragging.node.id
            ? { ...n, x: pos.x - dragging.startX, y: pos.y - dragging.startY }
            : n
        )
      )
      return
    }
    const hit = nodes.find((n) => {
      const dx = n.x - pos.x
      const dy = n.y - pos.y
      return Math.sqrt(dx * dx + dy * dy) < NODE_RADIUS + 4
    })
    setHoveredNode(hit || null)
  }, [nodes, dragging, getMousePos])

  const handleMouseUp = useCallback(() => {
    setDragging(null)
  }, [])

  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setScale((s) => Math.min(3, Math.max(0.3, s * delta)))
  }, [])

  return (
    <div className="relation-graph-container" ref={containerRef} style={{ width: '100%', minHeight: 400 }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: height || 400, cursor: dragging ? 'grabbing' : 'grab', display: 'block' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
      {hoveredNode && (
        <div className="relation-graph-tooltip">
          {hoveredNode.label}（{hoveredNode.role}）
        </div>
      )}
    </div>
  )
}
