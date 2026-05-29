/**
 * Simple force-directed layout for character relation graph.
 * Nodes repel each other; edges pull connected nodes together.
 */

const MIN_DIST = 60 // minimum distance between node centers (2 * NODE_RADIUS)

export function computeForceLayout(nodes, edges, options = {}) {
  const {
    width = 600,
    height = 400,
    iterations = 300,
    repulsion = 20000,
    attraction = 0.005,
    damping = 0.85,
  } = options

  const margin = 50
  const areaW = width - margin * 2
  const areaH = height - margin * 2

  // Initialize positions in a circle layout for better starting spread
  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(areaW, areaH) / 3
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.x == null) {
      const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2
      node.x = cx + Math.cos(angle) * radius + (Math.random() - 0.5) * 40
      node.y = cy + Math.sin(angle) * radius + (Math.random() - 0.5) * 40
    }
    node.vx = 0
    node.vy = 0
  }

  // Build adjacency lookup
  const edgeMap = new Map()
  for (const node of nodes) {
    edgeMap.set(node.id, [])
  }
  for (const edge of edges) {
    const fromList = edgeMap.get(edge.from) || []
    fromList.push({ other: edge.to, type: edge.type })
    edgeMap.set(edge.from, fromList)
    const toList = edgeMap.get(edge.to) || []
    toList.push({ other: edge.from, type: edge.type })
    edgeMap.set(edge.to, toList)
  }

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion between all node pairs (with minimum distance to prevent explosion)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        const dist = Math.max(MIN_DIST, Math.sqrt(dx * dx + dy * dy))
        const force = repulsion / (dist * dist)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
    }

    // Attraction along edges
    for (const node of nodes) {
      const neighbors = edgeMap.get(node.id) || []
      for (const { other } of neighbors) {
        const otherNode = nodes.find((n) => n.id === other)
        if (!otherNode) continue
        let dx = otherNode.x - node.x
        let dy = otherNode.y - node.y
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
        const force = dist * attraction
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        node.vx += fx
        node.vy += fy
      }
    }

    // Apply velocity with damping, clamp to bounds
    for (const node of nodes) {
      node.vx *= damping
      node.vy *= damping
      node.x += node.vx
      node.y += node.vy

      // Keep within margins
      if (node.x < margin) node.x = margin
      if (node.x > width - margin) node.x = width - margin
      if (node.y < margin) node.y = margin
      if (node.y > height - margin) node.y = height - margin
    }
  }

  // Center the graph (only if spread is smaller than available space)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const node of nodes) {
    if (node.x < minX) minX = node.x
    if (node.x > maxX) maxX = node.x
    if (node.y < minY) minY = node.y
    if (node.y > maxY) maxY = node.y
  }
  const graphW = maxX - minX
  const graphH = maxY - minY
  if (graphW < areaW && graphH < areaH) {
    const offsetX = cx - (minX + maxX) / 2
    const offsetY = cy - (minY + maxY) / 2
    for (const node of nodes) {
      node.x += offsetX
      node.y += offsetY
    }
  }

  return { nodes, edges }
}
