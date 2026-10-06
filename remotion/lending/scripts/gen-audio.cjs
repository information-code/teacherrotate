// 設備借用教學影片：逐句產生曉臻旁白 mp3，依 96kbps CBR 檔案大小換算長度寫入 durations.json
// 用法：node remotion/lending/scripts/gen-audio.cjs
// 這台機器上 renameSync 與刪目錄會被安全軟體擊殺（exit 127）：以 copyFileSync 落檔，暫存資料夾跑完後用 rm -rf 清。
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const outDir = path.join(root, 'assets', 'audio')
fs.mkdirSync(outDir, { recursive: true })

async function main() {
  const narration = JSON.parse(fs.readFileSync(path.join(root, 'narration.json'), 'utf8'))
  const durations = {}
  for (const scene of narration) {
    durations[scene.id] = []
    for (const [i, text] of scene.phrases.entries()) {
      const tts = new MsEdgeTTS()
      await tts.setMetadata('zh-TW-HsiaoChenNeural', OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)
      const tmpDir = path.join(outDir, `_tmp_${scene.id}_${i}`)
      fs.mkdirSync(tmpDir, { recursive: true })
      const result = await tts.toFile(tmpDir, text)
      const target = path.join(outDir, `${scene.id}_${i}.mp3`)
      fs.copyFileSync(result.audioFilePath, target)
      // 暫存資料夾留給 shell 清（node 刪目錄同樣會被安全軟體擊殺）
      const seconds = Math.round((fs.statSync(target).size / 12000) * 100) / 100
      durations[scene.id].push(seconds)
      console.log('OK', `${scene.id}_${i}`, seconds + 's', text)
    }
  }
  fs.writeFileSync(path.join(outDir, 'durations.json'), JSON.stringify(durations, null, 2))
  console.log('durations.json updated')
}

main().catch(e => { console.error(e); process.exit(1) })
