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
- Agent ghi thêm dòng đồng tác giả ở cuối commit nếu công cụ có yêu cầu, ví dụ `Co-Authored-By: ...`.
- **Không commit:** `node_modules/`, `tools/*.exe`, file `.log`, thư mục hồ sơ trình duyệt (ví dụ `chromeprof*/`), ảnh chụp màn hình khi test, file `.env` hay mọi thứ chứa mật khẩu/token.

### Nhánh và đẩy code

- Nhánh chính là `main`. Agent **không push thẳng lên `main`** và không force-push, trừ khi chủ dự án yêu cầu rõ ràng.
- Đặt tên nhánh theo loại việc: `feature/<tên-ngắn>`, `update/<tên-ngắn>`, `fix/<tên-ngắn>`, rồi mở Pull Request vào `main`.
- Commit và push chỉ khi được yêu cầu. Trước khi push, xem lại `git status` và `git diff --staged`.

## 2. Ràng buộc quan trọng

- **Nhân vật, tên và hình ảnh phải tự sáng tác.** Không được dùng hay mô phỏng nhân vật, tên, trang phục, chiêu thức đặc trưng, logo, nhạc hoặc map của anime, manga hay game có bản quyền, kể cả khi đổi tên. Được lấy cảm hứng chung theo kiểu "ninja gió", "kiếm sĩ lửa"; không được làm bản sao của một nhân vật cụ thể. Bốn nhân vật hiện tại (Kaze, Raiga, Homura, Yuki) đều là nhân vật gốc.
- **Không dùng file asset.** Không có file model, texture hay âm thanh nào: hình khối, texture canvas, shader và âm thanh WebAudio đều sinh bằng code. Giữ nguyên hướng này để game nhẹ và không vướng bản quyền.
- **Phải chạy mượt trên máy yếu và điện thoại.** Tính năng mới cần chạy được ở chất lượng `low` và có cách điều khiển bằng cảm ứng.
- **Chữ hiển thị cho người chơi và chú thích trong code viết bằng tiếng Việt.** Tên biến và hàm viết bằng tiếng Anh.

## 3. Cấu trúc dự án

```
server/            Node.js (ESM). 1 cổng duy nhất: HTTP tĩnh + WebSocket ở /ws
  index.js         Hub: sảnh chờ, tạo/vào phòng, phục vụ file tĩnh, /api/info, cờ --port --host --upnp --tunnel
  room.js          Phòng đối kháng (cả đấu đội: phòng chờ → trận → kết quả): mô phỏng chiêu, sát thương, hồi máu/mana
  shooter.js       Phòng bắn súng: vòng đấu, kinh tế, bom, súng rơi, lựu đạn
  loop.js          Vòng lặp tick theo lịch cố định (xem mục 5)
  upnp.js, tunnel.js  Mở port qua UPnP / tạo link qua Cloudflare Tunnel
shared/            Code chạy chung cho server và trình duyệt
  config.js        NET (nhịp mạng), Ticker, GAME, MOVE, ARENA (map mặc định), va chạm đấu trường
  characters.js    Nhân vật và chiêu thức, dạng dữ liệu (thêm nhân vật ở đây)
  arenas.js        Map chế độ đối kháng: trụ, hộp, điểm hồi sinh, theme
  steer.js         Lái tuyệt kỹ theo tâm ngắm
  weapons.js       Súng, trang bị, lựu đạn, bảng mua đồ, phe, hằng số chế độ bắn súng
  maps.js          Map bắn súng, va chạm, raycast, mô phỏng lựu đạn
client/            Trình duyệt, không có bước build
  index.html, style.css
  js/main.js       Menu, chọn chế độ/map, chuyển giữa 2 game
  js/game.js       Chế độ đối kháng (góc nhìn thứ 3)
  js/effects.js    Particle GPU, shader và hiệu ứng từng loại chiêu
  js/chibi.js, world.js, ui.js, audio.js, net.js, touch.js
  js/shooter/      Chế độ bắn súng: sgame.js, mapview.js, guns.js
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

- **Có thể máy không cài sẵn Node.** Chạy `node -v` để kiểm tra trước. Nếu không có, tải bản Node portable (≥ 18) vào thư mục tạm, đừng cài vào hệ thống khi chưa hỏi chủ dự án.
- **Hiện chưa có bộ test tự động.** Tối thiểu cần làm:
  1. `node --check <file>` cho mọi file JS đã sửa (kể cả file client).
  2. Chạy server và mở 2 tab trình duyệt vào cùng phòng, xem cả 2 người chơi có thấy nhau, đánh hay bắn trúng nhau không.
  3. Sửa giao diện cảm ứng thì thử ở chế độ giả lập điện thoại trong DevTools, cả màn hình ngang lẫn dọc.
- Viết script test dùng WebSocket (Node ≥ 22 có sẵn `WebSocket`) để giả lập nhiều người chơi khi sửa logic server. Nếu đáng giữ lại, đặt script vào thư mục `tests/`.
- **Mở nhanh để test:** `/?quick&mode=brawl|bomb|dm&map=<id map>` (đối kháng: `shrine`, `tournament`, `wasteland`, `village`; bắn súng: `lantern`, `temple`) vào thẳng phòng có map đó, chưa có thì tạo mới, `/?room=<ID>` vào phòng có sẵn.
- **Gỡ lỗi trong console:** `window.__game` là chế độ đối kháng, `window.__shooter` là chế độ bắn súng.
- File client được phục vụ với `no-cache`. Sửa client chỉ cần tải lại trang. Sửa `server/` hoặc `shared/` thì phải khởi động lại server.

## 5. Kiến trúc mạng: đọc kỹ trước khi sửa

### Giao thức

- Mỗi gói tin là một đối tượng JSON có trường `t` (loại gói).
- Tên loại gói ở chế độ bắn súng có tiền tố `s`, ví dụ `sj`, `ss`, `sshot`, `shit`, `sdie`.
- Thêm loại gói mới thì phải sửa cả server lẫn client, và kiểm tra dữ liệu đầu vào ở server: `Number.isFinite`, giới hạn độ dài, giới hạn giá trị.
- **Nhịp mạng** chỉnh tập trung ở `NET` trong `shared/config.js`. Hiện tại: tick 30 Hz, snapshot 30 Hz, client gửi vị trí 30 Hz, nội suy trễ 70 ms.
- **Nén gói tin:** server bật `permessage-deflate`, gói nhỏ hơn 128 byte gửi thẳng không nén. Nén giảm khoảng 70% băng thông nhưng tốn gần gấp đôi CPU.

### Ai quyết định cái gì

| Thứ | Ai quyết định |
|---|---|
| Di chuyển của chính mình | Client tự quyết để mượt. Server chỉ chặn các trường hợp vô lý |
| Máu, mana, hồi chiêu, sát thương (đối kháng) | Server. Client hiện hiệu ứng trước (dự đoán) rồi ghép với ID chiêu của server (`cs` → `eid`) |
| Trúng đạn (bắn súng) | Client tự tính trúng/trượt rồi gửi lên. Server kiểm tra lại khoảng cách tới mục tiêu, tường chắn (`rayMap`), tốc độ bắn và số đạn |
| Vòng đấu, tiền, bom, súng rơi, lựu đạn | Server |

### Bẫy đã gặp

- **Timer trên Windows chỉ chính xác khoảng 15,6 ms.** `setInterval(fn, 33)` trên Windows thực tế chạy khoảng 47 ms. Vòng lặp server luôn dùng `startLoop()` trong `server/loop.js`. Bộ đếm gửi theo nhịp luôn dùng `Ticker` trong `shared/config.js`, không tự viết bộ đếm rồi đặt lại về 0.
- **Lựu đạn mô phỏng tất định:** bước cố định `NADE_STEP` (1/60 giây), dữ liệu đầu vào làm tròn 3 chữ số. Code phải giống hệt nhau ở server và client để quỹ đạo khớp. Sửa `stepNade` là ảnh hưởng cả hai bên.
- **Tuyệt kỹ lái theo tâm:** mỗi chiêu có cấu hình `skill.steer`. `shared/steer.js` chạy ở cả hai bên: server dùng để tính sát thương, client dùng cho hiệu ứng. Client gửi gói `steer` khoảng 15 lần/giây, server chuyển tiếp cho người khác. Thêm tuyệt kỹ mới thì chọn một trong các chế độ `follow`, `homing`, `turn` hoặc viết thêm chế độ trong `steer.js`.
- **Thứ tự gói khi vào phòng bắn súng:** server phải gửi `sj` trước `sspawn`. Đảo thứ tự thì client bỏ qua lần xuất hiện đầu tiên.
- **Đấu đội** dùng chung `server/room.js` với cờ `this.team`. Gói tin có tiền tố `t`: client gửi `tteam`, `tready`, `tstart`; server gửi `tstate` (giai đoạn, chủ phòng, tỉ số, thời gian còn lại, lý do chưa bắt đầu được, danh sách `[id, đội, sẵn sàng, hạ, gục]`). Mọi chỗ chọn mục tiêu (`targets()` ở server, `aimDir`/`steerAim` ở client) phải bỏ qua đồng đội. Ngoài giai đoạn `play`, `damage()` không trừ máu.

## 6. Đồ hoạ và hiệu ứng

- Nhân vật được dựng từ khối cơ bản, tô kiểu hoạt hình (toon shading) và có viền đen bằng mesh viền.
- Hiệu ứng chiêu thức nằm trong `SKILL_FX` ở `client/js/effects.js`, mỗi loại chiêu một hàm.
- **Tránh màn hình trắng xoá:**
  - Ưu tiên chế độ hoà màu thường. Hạn chế hoà màu cộng sáng (additive) và độ sáng của bloom.
  - Particle ở gần camera phải mờ dần.
  - Chiêu lớn hoặc nhiều chiêu cùng lúc rất dễ làm màn hình trắng xoá. Kiểm tra lại các trường hợp này.
- **Shader cần làm nóng trước** (warmup) để lần ra chiêu đầu tiên không bị giật khung hình. Thêm material hay shader mới thì đưa vào phần warmup.
- **Chế độ bắn súng:** map gộp geometry để giảm số lần vẽ (draw call). Súng cầm tay được vẽ ở một lượt render riêng.

## 7. Điều khiển trên điện thoại

- `client/js/touch.js` cung cấp joystick ảo ở nửa trái màn hình, vuốt nửa phải để xoay camera, và các nút do từng chế độ khai báo qua `setButtons()`.
- Nút có `look: true` thì vừa giữ nút vừa kéo được để xoay camera. Nút ★ (tuyệt kỹ) và nút bắn dùng cách này.
- **Chặn zoom của trình duyệt:**
  - Đã chặn chạm đúp, chụm 2 ngón và cử chỉ zoom riêng của iPhone.
  - CSS dùng `touch-action: manipulation` cho cả trang. Riêng canvas và lớp `#touch` dùng `touch-action: none`.
  - Không bỏ các thiết lập này. Menu vẫn phải cuộn được.
- Mỗi phím mới trên bàn phím phải có nút cảm ứng tương ứng, hoặc có cách khác để làm được việc đó trên điện thoại.

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
  - Gói tin mới: `tp`, `buff`, `mark`, `chain`, `kmark`; `cast` có thể kèm `tg` (điểm đích) và `pend` có thể kèm `fire` (bẫy sập).
  - Thêm nhiều tia sét hay đèn chớp cùng lúc rất dễ trắng xoá màn hình: dùng `fx.bolt(..., light = false)` cho các tia phụ.
  - Chạy lại các test chiêu: mỗi chiêu phải trúng được đối thủ đứng đúng tầm.
  - Kiểu chiêu mới cần sửa cả 3 nơi: mô phỏng ở `server/room.js`, hiệu ứng ở `client/js/effects.js`, thời gian tồn tại ở `skillLifetime`.
- **Súng mới:** thêm vào `WEAPONS` và `BUY_MENU` trong `shared/weapons.js`. Mô hình súng thêm trong `client/js/shooter/guns.js`.
- **Map đối kháng mới:**
  - Khai báo trong `ARENAS` ở `shared/arenas.js`: `radius`, trụ `obstacles` `[x, z, bán kính, cao]`, hộp `boxes` `[x, z, nửa rộng X, nửa rộng Z, cao]` và `spawns`.
  - Viết theme trong `THEMES` ở `client/js/world.js`: trời, sàn, cách vẽ trụ/hộp, cảnh trang trí, hạt bay. Nóc chướng ngại vật trong hình phải nằm đúng độ cao `h`, vì người chơi đứng được trên đó.
  - Thêm một lựa chọn vào `#arenaPick` trong `client/index.html`.
  - Kiểm tra điểm hồi sinh không nằm trong chướng ngại vật và cách mép sân ít nhất 2 m.
  - Va chạm luôn đi qua `hitsObstacle`, `arenaGround`, `arenaCollide` trong `shared/config.js` và truyền map của phòng vào. Không đọc thẳng `ARENA`.
- **Map bắn súng mới:** thêm vào `MAPS` trong `shared/maps.js`, gồm khối va chạm, điểm hồi sinh, điểm đặt bom và `theme`. Giao diện theo `theme` viết ở `client/js/shooter/mapview.js`.
- **Cân bằng game:** chỉnh số trong `shared/`. Sau khi chỉnh, khởi động lại server để server và client dùng cùng một bộ số.
