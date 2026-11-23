# Quy tắc cho Agent

File này dành cho mọi AI agent (Claude Code, Codex, Cursor, Copilot…) và người đóng góp vào dự án **Chibi Clash**: game 3D chibi chơi nhiều người trên trình duyệt, gồm chế độ đối kháng và bắn súng. Đọc hết file này trước khi sửa code. `README.md` là tài liệu cho người chơi. File này ghi những điều cần biết khi phát triển.

## 1. Quy tắc commit

### Định dạng

```
[LOẠI] Tóm tắt ngắn gọn bằng tiếng Việt (≤ 72 ký tự)

- Thay đổi gì và vì sao (không cần kể lại từng dòng code)
- Đã kiểm tra thế nào (test nào đã chạy, thử trên máy/điện thoại nào)
```

| Loại | Dùng khi | Ví dụ |
|---|---|---|
| `[FEATURE]` | Thêm tính năng, chế độ chơi, nhân vật, map, vũ khí mới | `[FEATURE] Thêm map thứ ba cho chế độ bắn súng` |
| `[UPDATE]` | Thay đổi hoặc cải thiện thứ đã có: cân bằng chỉ số, giao diện, hiệu ứng, thông số mạng | `[UPDATE] Tăng tốc độ lái lốc xoáy của Kaze lên 8 m/s` |
| `[FIX]` | Sửa lỗi | `[FIX] Chạm đúp nút đánh làm zoom màn hình trên điện thoại` |
| `[PERF]` | Tối ưu hiệu năng (FPS, CPU server, băng thông) mà không đổi hành vi | `[PERF] Gộp geometry map để giảm draw call` |
| `[REFACTOR]` | Sắp xếp lại code, không đổi hành vi | `[REFACTOR] Tách logic bom ra file riêng` |
| `[DOCS]` | Chỉ sửa tài liệu (README, AGENTS.md, chú thích) | `[DOCS] Bổ sung hướng dẫn chơi qua tunnel` |
| `[CHORE]` | Việc lặt vặt: script, cấu hình, `.gitignore`, phụ thuộc | `[CHORE] Cập nhật ws lên 8.18.1` |

### Nguyên tắc

- **Mỗi commit một việc.** Sửa lỗi và thêm tính năng để ở 2 commit riêng.
- **Không commit code hỏng.** Ít nhất phải chạy được server và vào được trận (xem mục 4).
- Nếu thay đổi làm chế độ chơi khác đi (phím, luật, chỉ số), cập nhật `README.md` trong cùng commit.
- **Phiên bản:** mỗi commit làm game khác đi phải tăng `VERSION` trong `shared/version.js` (kèm `VERSION_DATE`), sửa `"version"` trong `package.json` cho khớp và thêm mục vào `CHANGELOG.md`. `[FEATURE]` tăng số giữa (0.7.0 → 0.8.0); `[UPDATE]`, `[FIX]`, `[PERF]` tăng số cuối (0.7.0 → 0.7.1); `[REFACTOR]`, `[DOCS]`, `[CHORE]` giữ nguyên. Ghi số phiên bản ở dòng đầu thân commit, ví dụ `- Phiên bản 0.8.0`. Sau khi commit, điền mã commit vào mục tương ứng trong `CHANGELOG.md` ở commit sau. Số phiên bản hiện ở góc menu và bảng tạm dừng; server gửi `v` trong gói `welcome`, client chạy bản cũ sẽ được nhắc tải lại trang.
- Agent ghi thêm dòng đồng tác giả ở cuối commit nếu công cụ có yêu cầu, ví dụ `Co-Authored-By: ...`.
- **Không commit:** `node_modules/`, `tools/*.exe`, file `.log`, thư mục hồ sơ trình duyệt (ví dụ `chromeprof*/`), ảnh chụp màn hình khi test, file `.env` hay mọi thứ chứa mật khẩu/token.

### Nhánh và đẩy code

- Nhánh chính là `main`. Agent **không push thẳng lên `main`** và không force-push, trừ khi chủ dự án yêu cầu rõ ràng.
- Đặt tên nhánh theo loại việc: `feature/<tên-ngắn>`, `update/<tên-ngắn>`, `fix/<tên-ngắn>`, rồi mở Pull Request vào `main`.
- Commit và push chỉ khi được yêu cầu. Trước khi push, xem lại `git status` và `git diff --staged`.

## 2. Ràng buộc quan trọng

- **Nhân vật, tên và hình ảnh phải tự sáng tác.** Không được dùng hay mô phỏng nhân vật, tên, trang phục, chiêu thức đặc trưng, logo, nhạc hoặc map của anime, manga hay game có bản quyền, kể cả khi đổi tên. Được lấy cảm hứng chung theo kiểu "ninja gió", "kiếm sĩ lửa"; không được làm bản sao của một nhân vật cụ thể. Tám nhân vật hiện tại (Kaze, Raiga, Homura, Yuki, Shiden, Midori, Gantetsu, Kage) đều là nhân vật gốc.
- **Không dùng file asset.** Không có file model, texture hay âm thanh nào: hình khối, texture canvas, shader và âm thanh WebAudio đều sinh bằng code. Giữ nguyên hướng này để game nhẹ và không vướng bản quyền.
- **Phải chạy mượt trên máy yếu và điện thoại.** Tính năng mới cần chạy được ở chất lượng `low` và có cách điều khiển bằng cảm ứng.
- **Chữ hiển thị cho người chơi và chú thích trong code viết bằng tiếng Việt.** Tên biến và hàm viết bằng tiếng Anh.

## 3. Cấu trúc dự án

```
server/            Node.js (ESM). 1 cổng duy nhất: HTTP tĩnh + WebSocket ở /ws
  index.js         Hub: sảnh chờ, tạo/vào phòng, phục vụ file tĩnh, /api/info, nhịp tim + đo RTT, cờ --port --host --upnp --tunnel
  room.js          Phòng đối kháng (cả đấu đội, đấu tập): mô phỏng chiêu, sát thương, hồi máu/mana; newRoomId() dùng chung cho mọi loại phòng
  shooter.js       Phòng bắn súng: vòng đấu, kinh tế, bom, súng rơi, lựu đạn
  cards.js         Phòng đánh bài (Xì dách / Tiến lên): chia bài, lượt, tính tiền, bot ngồi ghế trống
  loop.js          Vòng lặp tick theo lịch cố định (xem mục 5)
  upnp.js, tunnel.js  Mở port qua UPnP / tạo link qua Cloudflare Tunnel
shared/            Code chạy chung cho server và trình duyệt
  version.js       Số phiên bản game (VERSION, VERSION_DATE); lịch sử ở CHANGELOG.md
  config.js        NET (nhịp mạng), Ticker, GAME, MOVE, ARENA (map mặc định), va chạm đấu trường
  characters.js    Nhân vật và chiêu thức, dạng dữ liệu (thêm nhân vật ở đây)
  arenas.js        Map chế độ đối kháng: trụ, hộp, điểm hồi sinh, theme
  steer.js         Lái tuyệt kỹ theo tâm ngắm
  weapons.js       Súng, trang bị, lựu đạn, bảng mua đồ, phe, hằng số chế độ bắn súng, độ tản shotSpread()
  maps.js          Map bắn súng, va chạm, raycast, mô phỏng lựu đạn
  cards.js         Luật bài: bộ bài, điểm Xì dách, bộ / chặn / gợi ý Tiến lên
client/            Trình duyệt, không có bước build
  index.html, style.css
  js/main.js       Menu, chọn chế độ/map, chuyển giữa đối kháng / bắn súng / đánh bài
  js/game.js       Chế độ đối kháng (góc nhìn thứ 3)
  js/effects.js    Particle GPU, shader và hiệu ứng từng loại chiêu
  js/chibi.js, world.js, ui.js, audio.js, net.js, touch.js, keys.js (gán phím)
  js/shooter/      Chế độ bắn súng: sgame.js, mapview.js, guns.js
  js/cards/        Chế độ đánh bài: cgame.js (bàn tròn 3D, lá bài vẽ canvas, giao diện HTML)
tests/             Script kiểm tra bằng WebSocket: shooter-hit.mjs, stress.mjs, awaken.mjs (xem mục 4)
tools/             cloudflared.exe (không commit), README.txt
```

- **Import trong `shared/`:** server import bằng đường dẫn tương đối `'../shared/x.js'`, trình duyệt import bằng `'/shared/x.js'`. Code trong `shared/` không được dùng API riêng của Node (`fs`, `Buffer`…) hay của trình duyệt (`window`, `document`, `THREE`).
- **three.js** được khoá ở phiên bản `0.170.0`. Trình duyệt tải nó qua importmap `/vendor/three/...`, server phục vụ thư mục này thẳng từ `node_modules/three`. Khi đổi phiên bản phải kiểm tra lại các addon (EffectComposer, UnrealBloomPass…).
- **Chỉ có 2 thư viện phụ thuộc** là `three` và `ws`. Hạn chế thêm thư viện. Nếu thật sự cần, khoá phiên bản chính xác.

## 4. Chạy và kiểm tra

```bash
npm install
npm start                       # http://localhost:3000
node server/index.js --port 3123   # chạy cổng khác để test, không đụng server đang chơi
```

- **Có thể máy không cài sẵn Node.** Chạy `node -v` để kiểm tra trước. Nếu không có, tải bản Node portable (≥ 22, vì script trong `tests/` dùng `WebSocket` có sẵn) vào thư mục tạm, đừng cài vào hệ thống khi chưa hỏi chủ dự án.
- **Hiện chưa có bộ test tự động.** Tối thiểu cần làm:
  1. `node --check <file>` cho mọi file JS đã sửa (kể cả file client).
  2. Chạy server và mở 2 tab trình duyệt vào cùng phòng, xem cả 2 người chơi có thấy nhau, đánh hay bắn trúng nhau không.
  3. Sửa giao diện cảm ứng thì thử ở chế độ giả lập điện thoại trong DevTools, cả màn hình ngang lẫn dọc.
- Viết script test dùng WebSocket (Node ≥ 22 có sẵn `WebSocket`) để giả lập nhiều người chơi khi sửa logic server. Nếu đáng giữ lại, đặt script vào thư mục `tests/`. Hiện có `tests/shooter-hit.mjs`: giả lập trễ mạng, kiểm tra server nhận phát bắn hợp lệ (sniper xa, người bắn đang chạy) và từ chối phát gian lận (`node tests/shooter-hit.mjs 3123 150 60` khi server chạy ở cổng 3123).
- `tests/stress.mjs`: bot ở cả 7 chế độ (gồm đấu tập và 2 chế độ đánh bài) vào/ra liên tục, ngắt đột ngột, bot không trả ping, gói rác/thiếu trường/số khổng lồ; đạt khi server không chết, bot ở suốt trận không bị ngắt và không còn phòng sót (`node tests/stress.mjs 3123 60`). Log server cũng phải sạch: dòng `[msg] ...` là một handler đã ném lỗi, cần sửa. Sửa xử lý gói tin ở server hoặc thêm gói/chế độ mới thì chạy lại (thêm gói mới vào `TYPES`/`FIELDS` của script).
- `tests/cards.mjs`: kiểm tra chế độ đánh bài (Xì dách và Tiến lên với bot, che bài, tính tiền, sang ván). Chạy server ở cổng 3123 rồi `node tests/cards.mjs`.
- `tests/awaken.mjs`: kiểm tra dị biến (thanh tích, biến hình, nội tại, các kiểu chiêu dị biến, ngắm dọc, cơ chế dị biến v2 của cả 8 nhân vật) và chế độ đấu tập. Mất khoảng 5 phút. Chạy server ở cổng 3123 rồi `node tests/awaken.mjs`; sửa dị biến hay `damage()` thì chạy lại.
- **Mở nhanh để test:** `/?quick&mode=brawl|practice|bomb|dm|xidach|tienlen&map=<id map>&name=<tên>` (đối kháng: `shrine`, `tournament`, `wasteland`, `village`; bắn súng: `lantern`, `temple`) vào thẳng phòng có map đó, chưa có thì tạo mới, `/?room=<ID>` vào phòng có sẵn. Người chơi bắt buộc có tên, không có `name` (và chưa lưu tên) thì hiện hộp hỏi tên trước khi vào phòng.
- **Gỡ lỗi trong console:** `window.__game` là chế độ đối kháng, `window.__shooter` là chế độ bắn súng, `window.__cards` là chế độ đánh bài.
- File client được phục vụ với `no-cache`. Sửa client chỉ cần tải lại trang. Sửa `server/` hoặc `shared/` thì phải khởi động lại server.

## 5. Kiến trúc mạng: đọc kỹ trước khi sửa

### Giao thức

- Mỗi gói tin là một đối tượng JSON có trường `t` (loại gói).
- Tên loại gói ở chế độ bắn súng có tiền tố `s`, ví dụ `sj`, `ss`, `sshot`, `shit`, `sdie`.
- Thêm loại gói mới thì phải sửa cả server lẫn client, và kiểm tra dữ liệu đầu vào ở server: `Number.isFinite`, giới hạn độ dài, giới hạn giá trị. Mảng toạ độ phải kiểm tra đủ độ dài (`o.length === 3`), không chỉ `Array.isArray` (`[]` lọt qua thành `NaN`).
- **Gói tin ở server (`server/index.js`):** lỗi ném ra trong `ws.on('message')` làm chết cả process, mọi người bị out. Vì vậy:
  - Mỗi gói chạy trong `try/catch` (`onMsg`). Lỗi chỉ bỏ gói đó và ghi log `[msg]` một lần mỗi kết nối. Đây là lưới an toàn, không phải chỗ để dựa vào: handler vẫn phải tự kiểm tra dữ liệu.
  - `JSON.parse` có reviver bỏ khoá `toString`/`valueOf`: gói như `{"char":{"toString":1}}` làm `String()`, `| 0` và tra bảng ném lỗi.
  - Bảng tra bằng id do client gửi (`CHAR_BY_ID`, `ARENAS`, `MAPS`, `WEAPONS`, `EQUIPMENT`, `GRENADES`) phải là null-prototype (`Object.setPrototypeOf(x, null)`), nếu không `"constructor"`/`"__proto__"` tra ra hàm của `Object`. Bảng mới cũng làm vậy; chỗ cần chuỗi thì kiểm `typeof m.k === 'string'` trước khi tra.
  - Nhân vật người chơi chọn luôn qua `playableChar()`: `CHAR_BY_ID` chứa cả `SUMMONS`, `getChar('treant')` trả về Mộc Thần.
  - Bit cờ `128` (đã chết) do server gắn vào snapshot, không lấy từ client: gói `s` lấy `m.f & 127`, nếu không người chơi tự hiện "đã chết" với người khác mà vẫn đánh được.
  - Hành động có hồi chiêu phải giữ mốc ở server (ví dụ `dodge` dùng `p.dodgeAt`), nếu không spam gói là bất tử.
- **Nhịp tim** (`server/index.js`): server ping mỗi 5 s; kết nối không trả pong trước lượt sau thì bị `terminate()` và rời phòng. Ping/pong cũng dùng để đo RTT (`ws.rtt`, trung bình trượt). Chỉ gửi ping mới khi đã nhận pong của ping trước (`ws.pingAt`), không thì RTT đo từ mốc sai.
- **Id phòng** lấy từ `newRoomId()` trong `server/room.js` cho mọi loại phòng (đối kháng, bắn súng, đánh bài). Đừng thêm bộ đếm riêng: hai bộ đếm sẽ trùng id sau vài nghìn phòng.
- **Nhịp mạng** chỉnh tập trung ở `NET` trong `shared/config.js`. Hiện tại: tick 30 Hz, snapshot 30 Hz, client gửi vị trí 30 Hz, nội suy trễ 70 ms.
- **Nén gói tin:** server bật `permessage-deflate`, gói nhỏ hơn 128 byte gửi thẳng không nén. Nén giảm khoảng 70% băng thông nhưng tốn gần gấp đôi CPU.

### Ai quyết định cái gì

| Thứ | Ai quyết định |
|---|---|
| Di chuyển của chính mình | Client tự quyết để mượt. Server chỉ chặn các trường hợp vô lý |
| Máu, mana, hồi chiêu, sát thương (đối kháng) | Server. Client hiện hiệu ứng trước (dự đoán) rồi ghép với ID chiêu của server (`cs` → `eid`) |
| Trúng đạn (bắn súng) | Client tự tính trúng/trượt rồi gửi lên. Server kiểm tra lại điểm trúng có nằm sát quỹ đạo mục tiêu trong khoảng người bắn đang thấy không (bù trễ theo RTT đo bằng ping/pong WebSocket, `nearPast()`), tường chắn (`rayMap`), tốc độ bắn và số đạn |
| Vòng đấu, tiền, bom, súng rơi, lựu đạn | Server |

### Bẫy đã gặp

- **Timer trên Windows chỉ chính xác khoảng 15,6 ms.** `setInterval(fn, 33)` trên Windows thực tế chạy khoảng 47 ms. Vòng lặp server luôn dùng `startLoop()` trong `server/loop.js`. Bộ đếm gửi theo nhịp luôn dùng `Ticker` trong `shared/config.js`, không tự viết bộ đếm rồi đặt lại về 0.
- **Lựu đạn mô phỏng tất định:** bước cố định `NADE_STEP` (1/60 giây), dữ liệu đầu vào làm tròn 3 chữ số. Code phải giống hệt nhau ở server và client để quỹ đạo khớp. Sửa `stepNade` là ảnh hưởng cả hai bên.
- **Tuyệt kỹ lái theo tâm:** mỗi chiêu có cấu hình `skill.steer`. `shared/steer.js` chạy ở cả hai bên: server dùng để tính sát thương, client dùng cho hiệu ứng. Client gửi gói `steer` khoảng 15 lần/giây, server chuyển tiếp cho người khác. Thêm tuyệt kỹ mới thì chọn một trong các chế độ `follow`, `homing`, `turn` hoặc viết thêm chế độ trong `steer.js`.
- **Thứ tự gói khi vào phòng bắn súng:** server phải gửi `sj` trước `sspawn`. Đảo thứ tự thì client bỏ qua lần xuất hiện đầu tiên.
- **Bù trễ khi kiểm tra trúng đạn** (`server/shooter.js`): mỗi gói `s` lưu vị trí vào `p.hist` theo giờ server nhận (`pushHist()`, giữ `HIST_KEEP` = 1 s; hồi sinh thì xoá). `nearPast()` nhận điểm trúng nếu cách quỹ đạo mục tiêu ≤ `HIT_TOL` (1 m, theo phương ngang) trong khoảng lùi `rewind` = RTT + `NET.interp` + 2 snapshot + 0,1 s, tối đa `REWIND_MAX` (0,7 s). Đoạn di chuyển nhanh hơn `MAX_SPEED` (dịch chuyển tức thời) không được nội suy. Đổi `NET`, hitbox hay luật bắn thì chạy lại `tests/shooter-hit.mjs` ở RTT 150 và 300 ms.
- **Ngắm và độ tản (bắn súng):** độ tản tính ở một chỗ duy nhất là `shotSpread()` trong `shared/weapons.js`. Camera, tia bắn và tia ngắm cùng lấy góc dọc từ `aimPitch()` (gồm cả độ giật) trong `sgame.js`; tính riêng ở một nơi thì tâm scope lệch khỏi hướng đạn. Tia đạn (tracer) tính đầu nòng từ vị trí mắt và góc của chính phát bắn đó, không lấy camera của khung hình trước.
- **Avatar bắn súng không có `char`** (chỉ người chơi đối kháng có). Code dùng chung cho 2 chế độ, ví dụ biển tên ở `ui.js`, phải viết `av.char?.hp || GAME.maxHp`; đọc thẳng `av.char.hp` sẽ ném lỗi trong vòng lặp vẽ và đứng hình.
- **"Kết nối lại"** (`net.on('close')` ở `client/js/main.js`): nếu đang trong trận, nút tải lại trang với `?room=<id phòng đang chơi>` (bỏ `quick`) để vào lại đúng phòng; phòng đã bị xoá thì client nhận `err` và ở lại menu.
- **Dị biến** (`AWAKEN` ở `shared/config.js`, `awaken` của từng nhân vật ở `shared/characters.js`): server giữ thanh `p.awk` (cộng trong `damage()` khi chưa dị biến, trừ khi chiêu có `noGauge`) và `p.awUntil`. Client gửi `awk` để biến hình; server gửi `awk` (`on`, `dur`, `tf` / `tired`) cho cả phòng, `awkno` khi chưa đủ thanh. Snapshot thêm phần tử thứ 10 là thanh dị biến, `flags & 64` là đang dị biến. Chiêu dị biến gửi `cast` kèm `aw: 1`, hồi chiêu lưu ở chỉ số `sk + 10` (cả server `p.cds` lẫn client `L.cds`). Chọn bộ chiêu luôn qua `charSkills(char, aw)`, không đọc thẳng `char.skills`. Nội tại dị biến (`awaken.passive`) xử lý trong `damage()` và `tick()` (bỏng). Thêm dạng biến hình mới thì viết thêm một `case` trong `buildForm` ở `client/js/chibi.js` và một `case` hạt trang trí trong `formParticles` ở `client/js/game.js`.
- **Ngắm dọc:** `aimDir()` ở client nhắm thẳng vào ngực mục tiêu đang khoá (kể cả đang bay); server cho phép thành phần dọc của hướng ra chiêu tới ±0.95. Đạn có `seek` tự bẻ hướng 3D.
- **Tường gió** là chướng ngại vật tạm thời có `pass` (id chủ tường) / `passTeam` và `noBody`: `hitsObstacle(..., owner, team)` cho đạn của chủ tường bay xuyên, `dynCollide` bỏ qua `noBody`.
- **Công trình** (`room.props` ở server, `game.props` ở client): vật có máu do chiêu tạo ra, đối thủ đánh phá được. Hiện có cọc sét (`rod`, dị biến Shiden) và cột đá (`pillar`, dị biến Gantetsu). Server gửi gói `prop`: tạo mới (`id`, `k`, `o` chủ, `p`, `r`, `h`, `hp`, `dur`, `fr` tầm hàng rào), mất máu (`id`, `hp`) hoặc biến mất (`id`, `end`: `time` / `break` / `rip` / `quake`); người vào phòng giữa chừng nhận danh sách trong `joined.props`. `targets(e)` trả về cả công trình của đối thủ nên mọi chiêu đều đánh trúng được; chiêu chỉ nhắm người chơi (tự tìm, sét giáng, lướt chém, bẫy, động đất) gọi `targets(e, false)`. `damage()` gặp công trình thì chuyển sang `damageProp()`. Id công trình bắt đầu từ 100000 để không trùng id người chơi. Cột đá có `solid`: thêm chướng ngại vật vào `room.dyn` (server) và `fx.dynObs` (client); `groundHeight()` ở client tính cả nóc chướng ngại vật tạm thời nên đứng lên được. Thêm loại công trình mới thì viết một nhánh trong `fx.prop()` ở `client/js/effects.js`.
- **Dị biến v2** (đợt 1: Kaze, Shiden, Gantetsu): bay tự do (`passive.freeFly`; server không trừ mana cờ bay khi có `freeFly`), nhận thêm sát thương khi ở trên không (`passive.airTaken`, so với `arenaGround`), lướt 3 chiều (`free3d`, dùng nguyên `e.d`), phân thân gió (`clone`, gói `pulse` kiểu `windClone`), tường gió đẩy bay (`lift`, xử lý ở client), lái độ cao (`steer.fly`, trường `st.y` trong `shared/steer.js`), cọc sét (`rod`) + hàng rào điện (`updateFences()` ở server, `fx.fences()` ở client), dịch chuyển tới cọc (`toRod`), aoe phóng thêm ở cọc (`rodPulse`), smite có tia từ cọc (`rodDmg`), nhổ cột ném (`rip`; client gửi `rp` là id cột muốn nhổ, server kiểm tra lại, gửi `cast` kèm `rp`; bản chiêu khi nhổ được dựng sẵn ở `s.ripSkill`), động đất (`quake`: ai cao hơn mặt đất quá `airTol` thì né được, server gửi gói `evade`). Gói mới: `prop`, `pulse` (`k`: `windClone` / `rock` / `zap`), `evade`.
- **Người chơi giả** (`room.addFake()` / `removeFake()`): người chơi do server điều khiển, nằm chung trong `room.players` nên snapshot, chiêu thức, sát thương dùng y như người thật. `fake`: `dummy` (bia tập), `bot` (võ sĩ máy), `decoy` (phân thân mồi của Kage), `pet` (người cây của Midori). AI chạy trong `updateFake()` (vật lý đơn giản `stepFake()`, đẩy lùi áp ngay trong `damage()`), ra chiêu bằng chính `handleCast()`. Socket giả `FAKE_WS` không nhận gói. `room.count` chỉ đếm người thật (phòng hết người thật thì bị xoá). `publicPlayer(p, viewer)` gửi `fk` (loại) và `ms` (chủ); riêng phân thân chỉ lộ `fk`/`ms` với chủ và đồng đội của chủ, đối thủ thấy như người thật. Id người chơi giả bắt đầu từ 90000.
- **Đồng minh**: luôn kiểm tra bằng `room.allied(a, b)` (cùng đội, hoặc cùng phe `side()`: chủ + vật triệu hồi, bia + võ sĩ máy có `sideId` chung), không so `team` trực tiếp. Client: `isAlly(av)` và `allyId(a, b)`.
- **Vùng trên sàn** (`room.zones`, `game.zones` / `fx.zoneList`): `fire` (Homura: đứng vào bị bỏng), `ice` (Yuki: client tự xử lý trơn trượt, server không kiểm tra), `slow` (Thời Băng Giới: `mul` nhân tốc độ chạy ở client và tốc độ đạn của đối phương ở cả server `zoneSlow()` lẫn client `fx.zoneSlow()`). Server gửi gói `zone` một lần khi tạo, client tự xoá khi hết `dur`; người vào giữa chừng nhận trong `joined.zones`.
- **Đấu tập** (`mode: 'practice'`, `room.practice`): phòng đối kháng có sẵn 2 bia + 1 võ sĩ máy (`spawnPracticeBots()`); gói `pfill` nạp đầy thanh dị biến (chỉ chạy trong phòng đấu tập). `?quick&mode=practice` vào nhanh.
- **Dị biến v2 đợt 2–3**: Homura (`fireZone`, `passive.fireTrail`, `boomerang`, `ignite`, `passive.revive` xử lý đầu `kill()`, gói `revive`), Kage (`decoy`, blink `swap`, multiblink `dark` → gói `dark`), Yuki (`iceAt`, `iceTrail`, `icewall` là công trình có `shatter`, `timezone`, `passive.iceSpeed`), Raiga (`hold`: client gửi `hold` lúc bắt đầu giữ phím, `cast` kèm `hold` giây; server giới hạn theo lúc nhận gói `hold`, gửi `cast` kèm `hk` 0..1; bản chiêu phóng to lấy qua `holdSkill(s, k)`; `grab`: server điều khiển vị trí nạn nhân trong `stepGrab()`, bỏ qua gói `s` của nạn nhân, gói `grab`), Midori (`turret` là công trình bắn bằng `fireShot()`, gửi `cast` kèm `sub: 'tur'`; `pet` là người chơi giả, khung nhân vật lấy từ `SUMMONS` trong `shared/characters.js`). Gói mới: `zone`, `hold`, `grab`, `revive`, `dark`, `pfill`; `pulse` thêm `flame` / `shadowPop` / `iceBurst` / `slam`; `pleave` có thể kèm `why`.
- **Đánh bài** (`server/cards.js`, `shared/cards.js`, `client/js/cards/cgame.js`): chế độ `xidach` / `tienlen`, id phòng cũng lấy từ `newRoomId()`. Server quyết định toàn bộ và gửi trạng thái riêng cho từng người (gói `cs`: chỉ thấy bài của mình, bài người khác chỉ có số lá `n` cho tới khi lật). Client gửi `cbet`, `cready`, `chit`, `cstand` (xì dách), `cplay {cards}`, `cpass` (tiến lên), `cbot {d: ±1}` (thêm / bớt máy, lưu ở `room.botWant`, áp dụng ngay khi `canChangeBots()`, không thì từ ván sau), `char`, `chat`. Phòng mới ở giai đoạn `lobby` (không tự chia): `cready` ở phòng chờ bật / tắt `p.lready`, chủ phòng (`room.hostId`) gửi `cstart` (server kiểm tra `startBlock()`), `cdealer` (xì dách: chủ phòng làm nhà cái, `dealer.pid` = id chủ phòng, ghế `-1`, `p.isDealer`; `chit` / `cstand` của nhà cái đi vào `xdDealerHit/Stand`, tiền nhà cái = âm tổng tiền cả bàn), `cstop` (bật `stopAfter`, hết ván gọi `toLobby()`); server trả `cj` khi vào bàn, `cno` khi nước đi bị từ chối. Lá bài là số 0..51 (`hạng*4 + chất`, hạng theo Tiến lên: 3 … A, 2). Client tự diễn hoạt cảnh (chia, đánh, lật) bằng cách so trạng thái mới với lá bài đang có, nên không cần gói sự kiện riêng. Bot ngồi ghế trống (`rebalance()` đầu mỗi ván, số máy theo `botTarget()`); tới trắng xét ngay khi chia (`tlInstantWin`), thối heo cộng vào tiền trả khi hết ván (`tlHeoFine`); người rời giữa ván Tiến lên thì bot chơi thay. Luật nằm ở `shared/cards.js` để client hiện điểm, kiểm tra bộ chọn và gợi ý giống hệt server; sửa luật thì chạy lại `tests/cards.mjs`.
- **Đấu đội** dùng chung `server/room.js` với cờ `this.team`. Gói tin có tiền tố `t`: client gửi `tteam`, `tready`, `tstart`; server gửi `tstate` (giai đoạn, chủ phòng, tỉ số, thời gian còn lại, lý do chưa bắt đầu được, danh sách `[id, đội, sẵn sàng, hạ, gục]`). Mọi chỗ chọn mục tiêu (`targets()` ở server, `aimDir`/`steerAim` ở client) phải bỏ qua đồng đội. Ngoài giai đoạn `play`, `damage()` không trừ máu. Bắt đầu/kết thúc trận xoá chiêu đang tồn tại bằng `clearEntities()` (gửi `pend` `k: 0` để client xoá hiệu ứng), đừng gán `this.entities = []`. `teamCounts()` chỉ đếm người thật, không đếm người chơi giả.
- **Đặt bom:** phe rời hết giữa lúc chờ sang vòng thì `newRound()` gọi `checkWin()` để quay về khởi động; bom nổ gọi `endRound()` trước khi trừ máu (để thưởng đúng phe). Lựu đạn lưu `team` của người ném nên người ném rời phòng rồi thì lựu đạn vẫn không nổ trúng đồng đội của họ.

## 6. Đồ hoạ và hiệu ứng

- Nhân vật được dựng từ khối cơ bản, tô kiểu hoạt hình (toon shading) và có viền đen bằng mesh viền.
- Hiệu ứng chiêu thức nằm trong `SKILL_FX` ở `client/js/effects.js`, mỗi loại chiêu một hàm.
- **Tránh màn hình trắng xoá:**
  - Ưu tiên chế độ hoà màu thường. Hạn chế hoà màu cộng sáng (additive) và độ sáng của bloom.
  - Particle ở gần camera phải mờ dần.
  - Chiêu lớn hoặc nhiều chiêu cùng lúc rất dễ làm màn hình trắng xoá. Kiểm tra lại các trường hợp này.
- **Đồ sộ mà vẫn rõ:** độ hoành tráng lấy từ quy mô và nhịp, không lấy từ ánh sáng trắng.
  - Nổ tuyệt kỹ dùng `fx.ultImpact(pos, màu, lõi, bán kính)` (cột năng lượng, vết cháy, vết nứt, khói). Client tự gọi qua `ultCue()` ở `game.js` theo kiểu chiêu, khi có gói `boom` bán kính ≥ 4.5, và khi chiêu `leap` lớn đáp xuống.
  - Khựng hình `game.hitstop(giây)` và giật góc nhìn `game.fovKick(độ)` chỉ làm chậm hiệu ứng / hoạt ảnh, không đụng vật lý hay mạng.
  - Pha tụ lực tuyệt kỹ làm tối màn hình bằng lớp `#chargeVig`; lúc bung chiêu chớp màu bằng `#chargeFlash`. Hai lớp này cùng `#darkfog` phải nằm dưới HUD.
  - `fx.flash()` đã tự giới hạn cường độ và số đèn sáng cùng lúc. Đừng tăng lại hay gọi đèn cho từng mảnh nhỏ.
  - Lõi shader pha màu chính (không trắng thuần); sprite và quả cầu cộng sáng ở gần camera phải mờ.
  - Kiểm tra chiêu mới bằng cách chụp khung hình đậm nhất ở cả chất lượng cao lẫn thấp: phần màn hình trắng hoàn toàn nên dưới khoảng 10%.
- **Mô tả chiêu** (nút ! ở màn chọn nhân vật) sinh tự động trong `describeSkill()` ở `client/js/main.js` từ các trường của chiêu; tên gọi hình ảnh lấy theo `fx.kind` (`FX_NOUN`, `FX_DASH`...). Thêm trường hay kiểu chiêu mới thì thêm câu mô tả tương ứng; chiêu có `desc` thì câu đó đứng đầu.
- **Màn chọn nhân vật** có bia tập (`SUMMONS.dummy`) nhận đòn theo lịch ước lượng `previewHits()` trong `client/js/main.js`. Thêm kiểu chiêu mới thì thêm luôn một nhánh ở `previewHits()` và `pvTargetDist()`.
- **Shader cần làm nóng trước** (warmup trong `fx.warmup()`) để lần ra chiêu đầu tiên không bị giật khung hình. Thêm material hay shader mới thì đưa vào phần warmup. three.js biên dịch program riêng cho mỗi tổ hợp tham số: `side: DoubleSide`, `transparent`, `MeshToonMaterial` có hay không có `gradientMap` là các program khác nhau, phải có mặt từng loại trong warmup.
- **Giải phóng bộ nhớ GPU:** `removeFromParent()` chỉ gỡ khỏi cảnh, geometry vẫn nằm trên GPU. Cảnh chơi lâu sẽ tràn bộ nhớ trên điện thoại.
  - Model chibi gỡ bằng `model.dispose()` (`disposeObject()` trong `chibi.js`): dispose geometry và material riêng, bỏ qua material toon cache từ `toon()`, `outlineMat`, `FLASH_MAT`. Đổi dạng dị biến hay đổi nhân vật (cả mô hình xem trước ở menu) cũng phải gọi.
  - Hiệu ứng (`Effect.dispose()`) dispose mọi geometry không nằm trong bảng `GEO` và mọi material trong `e.mats` (đăng ký bằng `this.mat()` hoặc `e.mats.push()`). Geometry dùng chung mới phải thêm vào `GEO`, nếu không sẽ bị dispose khi một hiệu ứng kết thúc. Sprite dùng chung một geometry của three, không dispose.
  - Súng, tia đạn, lựu đạn, súng rơi ở chế độ bắn súng gỡ bằng `disposeObject()`; map bắn súng có `dispose()` riêng trong `mapview.js`.
- **Tab bị ẩn:** `requestAnimationFrame` dừng nhưng gói tin vẫn tới. Hiệu ứng tạo ra lúc đó không được cập nhật hay xoá, quay lại tab thì dồn hàng nghìn cái và khựng. `fx.add()` bỏ hiệu ứng khi `document.hidden`, trừ hiệu ứng có `persist` (công trình `fx.prop()`, vùng sàn `fx.zone()`, `stoneWalls()`, chiêu `summon`/`wall`): những thứ tồn tại lâu và có va chạm thì bỏ là mất suốt đời của chúng. Hiệu ứng mới có chướng ngại vật hoặc tác dụng lâu thì đặt `e.persist = true`. Tia đạn ở `sgame.js` không vẽ khi tab ẩn.
- **Việc chạy mỗi khung hình:** chỉ ghi `innerHTML`/style khi nội dung đổi (xem `_slotsHtml` trong `sgame.js`); particle chỉ đánh dấu `needsUpdate` khi có hạt thay đổi.
- **Chế độ bắn súng:** map gộp geometry để giảm số lần vẽ (draw call). Súng cầm tay được vẽ ở một lượt render riêng.

## 7. Điều khiển trên điện thoại

- `client/js/touch.js` cung cấp joystick ảo ở nửa trái màn hình, vuốt nửa phải để xoay camera, và các nút do từng chế độ khai báo qua `setButtons()`.
- Nút có `look: true` thì vừa giữ nút vừa kéo được để xoay camera. Nút ★ (tuyệt kỹ) và nút bắn dùng cách này.
- `touch.js` trả về độ kéo thô (`lk.dx`, `lk.dy`). Mỗi chế độ tự nhân `settings.sens` đúng một lần và áp `settings.invertY` cho cả chuột lẫn cảm ứng. Nhân thêm lần nữa trong `touch.js` thì độ nhạy bị bình phương.
- **Âm thanh trên iPhone:** cuộc gọi hay chuyển app để `AudioContext` ở trạng thái `interrupted`. Mỗi lần chạm (`pointerdown`) đều gọi `initAudio()`, hàm này `resume()` khi trạng thái khác `running`. Đừng đổi thành listener `once`.
- **Chặn zoom của trình duyệt:**
  - Đã chặn chạm đúp, chụm 2 ngón và cử chỉ zoom riêng của iPhone.
  - CSS dùng `touch-action: manipulation` cho cả trang. Riêng canvas và lớp `#touch` dùng `touch-action: none`.
  - Không bỏ các thiết lập này. Menu vẫn phải cuộn được.
- Mỗi phím mới trên bàn phím phải có nút cảm ứng tương ứng, hoặc có cách khác để làm được việc đó trên điện thoại.
- **Gán phím** (`client/js/keys.js`): logic game chỉ đọc "phím chuẩn" (`KeyJ`, `Space`, `ShiftLeft`…); phím thật người chơi bấm (kể cả chuột `Mouse0`/`Mouse2`) được dịch qua `translate(mode, code)` ở handler `keydown`/`mousedown`. Thêm phím mới thì khai báo một hành động trong `ACTIONS` (mục `brawl` hoặc `shooter`, có `code` chuẩn và `def` mặc định) rồi xử lý `code` chuẩn đó trong game; đừng đọc thẳng `e.code`. Chữ hiện cho người chơi lấy qua `actionKey()` / `comboKey()` hoặc thẻ `<kbd data-k="mode.id">` (tự điền), không ghi cứng tên phím.

## 8. Thêm nội dung

- **Nhân vật mới:**
  - Thêm một mục vào `CHARACTERS` trong `shared/characters.js`, gồm `hp` (máu tối đa), `speedMul`, `look` (ngoại hình) và 5 chiêu theo combo `J`, `K`, `JK`, `KL`, `JKL`.
  - Máu luôn đọc qua `charMaxHp()` (server lưu ở `p.maxHp`, client ở `av.char.hp`). Không dùng `GAME.maxHp` cho người chơi đối kháng.
  - **Cân bằng:** mục tiêu là chỉ số sức mạnh (sát thương/giây khi đánh bia đứng yên × máu) nằm trong khoảng ±15% so với trung bình. Nhân vật khống chế nhiều hoặc phải áp sát được thấp hơn một chút. Sau khi đổi số, đo lại sát thương thật ở server; đừng chỉ ước lượng trên giấy.
  - Bảng chỉ số ở menu (`STAT_DEFS` trong `client/js/main.js`) tự tính từ dữ liệu chiêu, không cần nhập tay.
  - Kiểu chiêu (`type`) có sẵn: `melee`, `projectile`, `dash`, `beam`, `aoe`, `line`, `rain`. Hiệu ứng chọn qua `fx.kind`.
  - `fx.kind` có sẵn theo từng kiểu chiêu:
    - `projectile`: `shuriken`, `crescent`, `iceShard`, `thorn`, `bolt`, `rock`, `bigBomb`; kiểu khác thì hiện quả cầu năng lượng.
    - `aoe`: `tornado`, `bladeStorm`, `flameRise`, `frostNova`, `bloom`, `quake`, `thunderRing`, `shadowMist`.
    - `line`: `firePillar`, `iceSpike`, `vineSpike`.
    - `rain`: `icicleRain`, `lightning`, `meteor`, `petalRain`.
  - Kiểu mượn hình của kiểu khác được khai báo ở `FX_ALIAS` trong `effects.js`. Màu chỉnh qua `fx.crystal`/`fx.crystalGlow` (vòng tinh thể), `fx.spike`/`fx.spikeGlow` (chuỗi gai); `fx.noCircle` tắt vòng phép.
  - Chiêu `aoe` có thể có `healSelf` để hồi máu cho người ra chiêu.
  - Kiểu chiêu đặc biệt: `trap` (bẫy tồn tại lâu), `summon` (vật triệu hồi có `obstacle` chắn đạn và `aura` hồi máu), `leap` (nhảy tới điểm tâm ngắm, client gửi `a` trong gói `cast`; `walls` dựng cột đá), `blink` (dịch chuyển, tới dấu phi đao nếu có), `buff` (`dmgTaken`, `noKb`, `stealth`, `nextHitMul`). Đạn có thể có `teleport` (người ném dịch chuyển tới chỗ đạn dừng) và `mark` (để lại dấu bóng).
  - Đòn kết chuỗi J: chiêu thứ 6 có `chain: true`, combo `JJJ`. Bảng combo bỏ qua nó; `doCast(0)` tự nâng thành đòn kết khi đã có 2 đòn J trong 1.2 s. Server kiểm tra lại bằng `p.jn`/`p.jLast`.
  - Nội tại nhân vật: `passive` (hiện có `charge` của Shiden, xử lý trong `addCharge()` ở `server/room.js`). Đòn có `noMark` không cộng dấu. Đòn kết có thể có `marks` (cộng nhiều dấu) hoặc `backstab` (nhân sát thương khi đứng sau lưng mục tiêu, dựa vào `yaw`).
  - Chướng ngại vật tạm thời: server giữ `room.dyn`, client giữ `fx.dynObs` (hiệu ứng tự thêm/bớt). Đạn ở cả hai phía phải truyền `dyn` vào `hitsObstacle()`.
  - Dịch chuyển do server quyết định và gửi gói `tp`; trong 0.35 s sau đó server bỏ qua vị trí cũ client gửi lên (`p.tpUntil`).
  - Gói tin mới: `tp`, `buff`, `mark`, `chain` (`sky`: sét giáng từ trời xuống từng điểm, `nosky`: bỏ tia đầu), `kmark`, `awk`, `awkno`; `cast` có thể kèm `tg` (điểm đích) và `aw` (chiêu dị biến), `pend` có thể kèm `fire` (bẫy sập), `boom` có thể kèm `k` (viên đạn nào nổ), `hit` có thể kèm `burn`, `frost`, `frz`.
  - Thêm nhiều tia sét hay đèn chớp cùng lúc rất dễ trắng xoá màn hình: dùng `fx.bolt(..., light = false)` cho các tia phụ.
  - Kiểu chiêu chỉ có ở dạng dị biến: `wall` (tường chắn đạn), `smite` (sét đánh mọi đối thủ trong tầm, `perMark` cộng theo dấu điện), `multiblink` (lướt chém lần lượt `strikes` nhát). Trường mới cho chiêu: `seek` (đạn tự tìm), `bounce` (sét nảy khi trúng), `multi`/`multiInt` (lướt đánh nhiều nhịp), `echo` (phân thân chém theo), `follow` (vùng aoe bám theo người), `walls` cho aoe, `height` (độ cao cú nhảy), `behind` (blink ra sau lưng), `invuln` cho buff, `bigCharge` (tụ lực lâu, hiệu ứng `chargeUp`; dash có `bigCharge` không được bất tử lúc tụ lực).
  - Mỗi nhân vật mới cần cả bộ `awaken` (6 chiêu cùng combo). Dạng dị biến nên mạnh hơn dạng thường khoảng 40–50% (sát thương/giây × máu), tuyệt kỹ dị biến tụ lực 1.2–1.4 giây.
  - Chạy lại các test chiêu: mỗi chiêu phải trúng được đối thủ đứng đúng tầm.
  - Kiểu chiêu mới cần sửa cả 3 nơi: mô phỏng ở `server/room.js`, hiệu ứng ở `client/js/effects.js`, thời gian tồn tại ở `skillLifetime`. Màn xem trước ở menu không có server: hiệu ứng cần dữ liệu từ server (ví dụ cột đá) phải tự dựng bản giả khi `ctx.preview` bật.
  - Kiểu chiêu dị biến v2: `pillar` (cột đá ở tâm ngắm, client gửi `a` như `leap`), `quake` (động đất cả sân), `decoy`, `icewall`, `timezone`, `turret`, `pet`. Bản thảo và ghi chú khi làm ở `docs/ban-thao-di-bien-v2.md`.
  - Vật triệu hồi có hình nhân vật (như Mộc Thần) khai báo trong `SUMMONS` (không hiện ở menu), dạng hình riêng viết thêm `case` trong `buildForm` ở `client/js/chibi.js`.
- **Súng mới:** thêm vào `WEAPONS` và `BUY_MENU` trong `shared/weapons.js`. Mô hình súng thêm trong `client/js/shooter/guns.js`.
- **Map đối kháng mới:**
  - Khai báo trong `ARENAS` ở `shared/arenas.js`: `radius`, trụ `obstacles` `[x, z, bán kính, cao]`, hộp `boxes` `[x, z, nửa rộng X, nửa rộng Z, cao]` và `spawns`.
  - Viết theme trong `THEMES` ở `client/js/world.js`: trời, sàn, cách vẽ trụ/hộp, cảnh trang trí, hạt bay. Nóc chướng ngại vật trong hình phải nằm đúng độ cao `h`, vì người chơi đứng được trên đó.
  - Thêm một lựa chọn vào `#arenaPick` trong `client/index.html`.
  - Kiểm tra điểm hồi sinh không nằm trong chướng ngại vật và cách mép sân ít nhất 2 m.
  - Va chạm luôn đi qua `hitsObstacle`, `arenaGround`, `arenaCollide` trong `shared/config.js` và truyền map của phòng vào. Không đọc thẳng `ARENA`.
- **Map bắn súng mới:** thêm vào `MAPS` trong `shared/maps.js`, gồm khối va chạm, điểm hồi sinh, điểm đặt bom và `theme`. Giao diện theo `theme` viết ở `client/js/shooter/mapview.js`.
- **Cân bằng game:** chỉnh số trong `shared/`. Sau khi chỉnh, khởi động lại server để server và client dùng cùng một bộ số.
