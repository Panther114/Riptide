p = 'src/render/shipArt.ts'
s = open(p, encoding='utf-8').read()
reps = [
    ("circle(50, 0, 8.6, steel, 'rgba(0,0,0,0.45)', 0.2);", "circle(cls.turrets[1].x, 0, 8.6, steel, 'rgba(0,0,0,0.45)', 0.2);"),
    ("tier(-50, 38, 10.2, 1.8, g1(-50, 38, 10.2), 12, 4);", "tier(-50, 31.5, 10.2, 1.8, g1(-50, 31.5, 10.2), 12, 4);"),
    ("for (const x of [27, 15, 3, -21, -33])", "for (const x of [24, 12, 0, -24, -36])"),
    ("for (let x = -46; x < 34; x += 4.2)", "for (let x = -46; x < 28; x += 4.2)"),
    ("tier(-3, 37, 7.8, 1.5, g1(-3, 37, 7.8), 10, 3);", "tier(-3, 29, 7.8, 1.5, g1(-3, 29, 7.8), 10, 3);"),
    ("ctx.beginPath(); ctx.ellipse(32.5, 0, 4.4, 4.6, 0, 0, Math.PI * 2); ctx.fillStyle = '#6b757b';", "ctx.beginPath(); ctx.ellipse(25.2, 0, 4.0, 4.4, 0, 0, Math.PI * 2); ctx.fillStyle = '#6b757b';"),
    ("ctx.beginPath(); ctx.ellipse(32.5, 0, 3.4, 3.6, 0, -0.9, 0.9); ctx.stroke();", "ctx.beginPath(); ctx.ellipse(25.2, 0, 3.0, 3.4, 0, -0.9, 0.9); ctx.stroke();"),
    ("tier(11, 31, 6.6, 1.3, g1(11, 31, 6.6), 9, 3);", "tier(8, 23.5, 6.6, 1.3, g1(8, 23.5, 6.6), 9, 3);"),
    ("tier(14, 28.5, 5.2, 1.2, light, 8, 2.5);", "tier(10.5, 21.5, 5.2, 1.2, light, 8, 2.5);"),
    ("ctx.beginPath(); ctx.roundRect(17.6, -3.6, 7.2, 7.2, 2.6); ctx.fillStyle = '#8a959a';", "ctx.beginPath(); ctx.roundRect(13.5, -3.6, 7.0, 7.2, 2.6); ctx.fillStyle = '#8a959a';"),
    ("ctx.fillStyle = '#39424a'; ctx.beginPath(); ctx.roundRect(20.4, -4.9, 1.4, 9.8, 0.6); ctx.fill();\n  ctx.fillStyle = '#c3cbcf'; ctx.fillRect(20.7, -1.1, 0.8, 2.2);",
     "ctx.fillStyle = '#39424a'; ctx.beginPath(); ctx.roundRect(16.3, -4.9, 1.4, 9.8, 0.6); ctx.fill();\n  ctx.fillStyle = '#c3cbcf'; ctx.fillRect(16.6, -1.1, 0.8, 2.2);"),
    ("ctx.beginPath(); ctx.moveTo(25.5, -6.2); ctx.lineTo(25.5, 6.2); ctx.moveTo(23.2, 0); ctx.lineTo(28, 0); ctx.stroke();\n  ctx.save(); ctx.translate(26.6, 0);",
     "ctx.beginPath(); ctx.moveTo(21.4, -6.2); ctx.lineTo(21.4, 6.2); ctx.moveTo(19.4, 0); ctx.lineTo(23.6, 0); ctx.stroke();\n  ctx.save(); ctx.translate(22.4, 0);"),
    ("for (const x of [30.5, -30.5]) {\n    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 6;\n    ctx.beginPath(); ctx.roundRect(x - 2.2, -2.4, 4.4, 4.8, 1.4); ctx.fillStyle = '#7f8a90'; ctx.fill(); ctx.restore();\n    ctx.fillStyle = '#2f373c'; ctx.fillRect(x - 0.3, -3.2, 0.6, 6.4);\n  }",
     "for (const [x, y] of [[4.5, -6.6], [4.5, 6.6], [-46.5, 0]]) {\n    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 6;\n    ctx.beginPath(); ctx.roundRect(x - 2.2, y - 2.4, 4.4, 4.8, 1.4); ctx.fillStyle = '#7f8a90'; ctx.fill(); ctx.restore();\n    ctx.fillStyle = '#2f373c'; ctx.fillRect(x - 0.3, y - 3.2, 0.6, 6.4);\n  }"),
    ("funnel(ctx, -17.5, 10, 6.6);", "funnel(ctx, -23, 10, 6.6);"),
    ("boat(ctx, -5.5, sd * 6.6, 9.5, 2.7);\n    ctx.save(); ctx.translate(-26, sd * 5.2);", "boat(ctx, -9, sd * 6.6, 9.5, 2.7);\n    ctx.save(); ctx.translate(-30, sd * 5.2);"),
    ("circle(-26, sd * 5.2, 1.1, '#5b646a');", "circle(-30, sd * 5.2, 1.1, '#5b646a');"),
    ("ctx.beginPath(); ctx.moveTo(-28.5, -6.5); ctx.lineTo(-28.5, 6.5); ctx.stroke();", "ctx.beginPath(); ctx.moveTo(-32.5, -6.5); ctx.lineTo(-32.5, 6.5); ctx.stroke();"),
    ("[[36, -7], [36, 7], [-1, -7.8], [-1, 7.8],", "[[29.5, -8], [29.5, 8], [-1, -7.8], [-1, 7.8],"),
    ("[[-87, -11], [-87, 11], [-61, -12.5], [-61, 12.5]]", "[[-79, -10.5], [-79, 10.5], [-52, -12.8], [-52, 12.8]]"),
    ("b(-50, 38, 10.2); b(-3, 37, 7.8); b(11, 31, 6.6); b(14, 28.5, 5.2); b(17.6, 24.8, 3.6);", "b(-50, 31.5, 10.2); b(-3, 29, 7.8); b(8, 23.5, 6.6); b(10.5, 21.5, 5.2); b(13.5, 20.5, 3.6);"),
    ("c.beginPath(); c.ellipse(8, 0, 4.8, 3.2, 0, 0, 7); c.fill();", "c.beginPath(); c.ellipse(6.5, 0, 5.2, 3.6, 0, 0, 7); c.fill();"),
    ("c.beginPath(); c.ellipse(-18, 0, 4.8, 3.0, 0, 0, 7); c.fill();", "c.beginPath(); c.ellipse(-23, 0, 5.0, 3.3, 0, 0, 7); c.fill();"),
]
for a, b in reps:
    if a not in s:
        print('MISSING:', a[:70])
    s = s.replace(a, b)
open(p, 'w', encoding='utf-8').write(s)
print('done')
