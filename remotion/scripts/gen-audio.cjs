// 產生曉臻旁白 mp3＋依 CBR 檔案大小換算長度寫入 durations.json
// 用法：node remotion/scripts/gen-audio.cjs
// 注意：這台機器上 renameSync 與 music-metadata 解析會被安全軟體悄悄擊殺（exit 127），
//       故用 copyFileSync 落檔、以 96kbps CBR 大小換算時長（12000 bytes/秒，實測誤差 <1%）。
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const outDir = path.join(root, 'assets', 'audio')
fs.mkdirSync(outDir, { recursive: true })

async function main() {
  const narration = JSON.parse(fs.readFileSync(path.join(root, 'narration.json'), 'utf8'))
  const durations = {}
  for (const item of narration) {
    const tts = new MsEdgeTTS()
    await tts.setMetadata('zh-TW-HsiaoChenNeural', OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
    const tmpDir = path.join(outDir, '_tmp_' + item.id)
    fs.mkdirSync(tmpDir, { recursive: true })
    const result = await tts.toFile(tmpDir, item.text)
    const target = path.join(outDir, item.id + '.mp3')
    fs.copyFileSync(result.audioFilePath, target)
    fs.rmSync(tmpDir, { recursive: true, force: true })
    durations[item.id] = Math.round(fs.statSync(target).size / 12000 * 100) / 100
    console.log('OK', item.id, durations[item.id] + 's')
  }
  fs.writeFileSync(path.join(outDir, 'durations.json'), JSON.stringify(durations, null, 2))
  console.log('durations.json updated')
}

main().catch(e => { console.error(e); process.exit(1) })
