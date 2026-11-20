# Chibi Clash ⚔

> **TM22 PvP Vibecode Game** — Your go-to vibe-coded game for post-work relaxation.

Game 3D nhân vật chibi, chơi nhiều người qua phòng (room), chạy trên trình duyệt máy tính **và điện thoại**. Server Node.js rất nhẹ.

Có 4 chế độ, chọn khi tạo phòng:

| Chế độ | Mô tả |
|---|---|
| ⚔ **Đối kháng** | Góc nhìn thứ 3, tung chiêu thức theo combo phím, máu + mana, ai cũng là đối thủ |
| 👥 **Đấu đội** | Như Đối kháng nhưng chia 2 đội Xanh / Đỏ, có phòng chờ, chủ phòng bấm bắt đầu |
| 💣 **Đặt bom** | Bắn súng góc nhìn thứ nhất, 2 phe Công (Hắc Long) / Thủ (Thiên Ưng), theo vòng, có mua đồ và tiền thưởng |
| 🔫 **Sinh tử** | Bắn súng tự do, ai cũng là đối thủ, hồi sinh nhanh, súng miễn phí |

- **Đồ hoạ**: nhân vật chibi dựng từ khối cơ bản + toon shading + viền đen; chiêu thức dùng particle GPU, shader năng lượng, vòng phép thuật, tia, lốc xoáy, cột lửa, mưa băng, bloom.
- **Nhẹ**: không có file model/texture/âm thanh nào — tất cả được sinh bằng code (âm thanh tổng hợp bằng WebAudio). Toàn bộ client chỉ khoảng 100 KB code + three.js.
- **Multiplayer**: tạo phòng / vào phòng, **không giới hạn người chơi**, server quyết định máu/mana/sát thương (chống gian lận cơ bản), client tự di chuyển để mượt, có nội suy vị trí người khác.

## Yêu cầu

- [Node.js](https://nodejs.org) 18 trở lên (khuyên dùng bản LTS). Trên Windows có thể cài bằng: `winget install OpenJS.NodeJS.LTS`
- Trình duyệt Chrome / Edge / Firefox bản mới.

## Cài đặt & chạy

```bash
npm install
npm start
```

Sau đó mở `http://localhost:3000`. Trên Windows có thể bấm đúp các file `.bat`:

| File | Chức năng |
|---|---|
| `start.bat` | Chạy server (máy này + mạng LAN) |
| `start-upnp.bat` | Chạy server + tự mở port trên router (UPnP) để bạn bè chơi qua Internet |
| `start-tunnel.bat` | Chạy server + tạo link công khai qua Cloudflare Tunnel (không cần mở port) |

### 3 cách cho người khác vào chơi

1. **Cùng máy / cùng mạng LAN (Wi-Fi nhà, quán net)**
   `npm start` — server lắng nghe trên `0.0.0.0:3000`. Màn hình console và menu game sẽ hiện địa chỉ dạng `http://192.168.x.x:3000`, gửi link đó cho bạn bè trong cùng mạng.
   Lần đầu chạy, Windows Firewall sẽ hỏi — hãy chọn **Allow** (cho phép mạng Private).
   Chỉ muốn chơi một mình trên máy: `npm start -- --host 127.0.0.1`.

2. **Qua Internet bằng mở port (UPnP)**
   `npm run upnp` — server tự yêu cầu router mở port 3000 và in ra `http://<IP-public>:3000`.
   Router phải bật UPnP. Nếu nhà mạng dùng CGNAT (IP WAN của router khác IP public thật) thì cách này không hoạt động → dùng cách 3.
   Có thể mở port thủ công trong trang quản trị router: chuyển tiếp TCP port 3000 tới IP LAN của máy chạy server.

3. **Qua Internet bằng tunnel (dễ nhất, không cần chỉnh router)**
   Cài `cloudflared` (`winget install Cloudflare.cloudflared`, hoặc tải `cloudflared.exe` đặt vào thư mục `tools/`), rồi chạy `npm run tunnel`. Server in ra link dạng `https://xxxx.trycloudflare.com` — gửi cho bạn bè là vào được.
   Các lựa chọn khác: ngrok (`ngrok http 3000`), hoặc VPN LAN ảo như Tailscale / ZeroTier / Radmin VPN (khi đó dùng như mạng LAN).

Tham số khác: `--port 3001` để đổi port. Ví dụ: `npm start -- --port 8080`.

Trong game, menu Esc → **Copy link mời bạn** sẽ copy link vào thẳng phòng đang chơi (`?room=ID`).

## Cách chơi

| Phím | Tác dụng |
|---|---|
| `W A S D` | Di chuyển theo hướng camera |
| Chuột | Xoay camera (click vào màn hình để khoá chuột), lăn chuột để zoom |
| `Space` | Nhảy · bấm lần 2 trên không: nhảy đôi · sau đó **giữ** Space: bay (tốn mana) |
| `Shift` | Lướt né (bất tử trong chốc lát) · giữ Shift sau khi lướt: chạy nhanh |
| `J` / chuột trái | Đánh thường (miễn phí, đánh trúng được cộng mana) |
| `K` / chuột phải | Chiêu 1 |
| `J`→`K` | Chiêu 2 |
| `K`→`L` | Chiêu 3 |
| `J`→`K`→`L` | Tuyệt kỹ |
| `H` | Hồi máu (tốn mana, có hồi chiêu) |
| giữ `U` | Vận khí: hồi mana rất nhanh nhưng phải đứng yên |
| `Tab` / `Enter` / `F1` / `Esc` | Bảng điểm / chat / hướng dẫn / menu |

Combo là chuỗi phím bấm liên tiếp nhanh (cách nhau dưới 0.5 giây). Chiêu tự khoá mục tiêu gần tâm màn hình nhất.

**Chuỗi đòn J:** bấm `J` (hoặc nút ⚔ trên điện thoại) 3 lần liên tiếp, đòn thứ 3 thành **đòn kết** riêng của mỗi nhân vật: Kaze phóng kunai xuyên thấu, Raiga đấm hất tung, Homura xoay kiếm lửa, Yuki chém băng làm chậm, Shiden đâm thương dài (thêm 2 dấu điện), Midori quấn dây leo (choáng), Gantetsu đập đất, Kage đâm sau lưng (×2.2 sát thương nếu đứng sau đối thủ).

**Lái tuyệt kỹ theo tâm:** trong lúc tuyệt kỹ còn hiệu lực, xoay chuột (điện thoại: giữ nút ★ rồi kéo, hoặc vuốt nửa phải màn hình) để điều khiển chiêu theo vòng tâm; một vòng sáng trên mặt đất cho biết điểm đang lái tới. Lốc xoáy (Kaze) và mưa băng (Yuki) trôi theo tâm, Tinh Cầu Hủy Diệt (Raiga) bẻ hướng bay cả lên/xuống, Phượng Hoàng (Homura) uốn cong đường lao. Tốc độ lái chỉnh ở `steer` của từng chiêu trong `shared/characters.js`.

**Máu & mana**: máu tự hồi chậm sau 5 giây không bị đánh; hồi nhanh hơn bằng chiêu Hồi Máu. Mana tự hồi nhanh hơn máu, vận khí (giữ U) hồi rất nhanh. Chiêu càng mạnh càng tốn nhiều mana và hồi chiêu lâu. Hết máu sẽ gục và hồi sinh sau 4 giây.

### Đấu đội

1. Tạo phòng ở chế độ **👥 Đấu đội** (chọn map như Đối kháng). Người tạo phòng là **chủ phòng 👑**.
2. Mỗi người vào phòng được xếp vào đội ít người hơn. Trong **phòng chờ** ai cũng có thể bấm **Vào Đội Xanh / Vào Đội Đỏ** để đổi đội, rồi bấm **✔ Sẵn sàng**.
3. Khi mỗi đội có ít nhất 1 người và mọi người đã sẵn sàng, chủ phòng bấm **▶ Bắt đầu**. Trong lúc chờ có thể bấm **🏃 Khởi động** để chạy nhảy thử chiêu (chưa mất máu); phím `T` hoặc nút **👥 Phòng chờ** để mở lại bảng.
4. Trong trận: chiêu thức đi xuyên qua đồng đội (không đánh nhầm), tên đồng đội/đối thủ có màu theo đội, mỗi đội hồi sinh ở nửa sân của mình. Hạ một đối thủ được 1 điểm; ai tự rơi khỏi sân thì đội kia được 1 điểm.
5. Đội nào đạt **20 điểm** trước, hoặc dẫn điểm khi hết **8 phút**, sẽ thắng (bằng điểm thì hoà). Nếu một đội không còn ai, đội kia thắng. Sau 8 giây cả phòng về lại phòng chờ.

Chủ phòng thoát thì người vào phòng sớm nhất còn lại thành chủ phòng. Người vào giữa trận được xếp vào đội ít người hơn và chơi luôn. Điểm thắng và thời gian chỉnh ở `TEAM` trong [shared/config.js](shared/config.js).

### Map đối kháng

Chọn map khi tạo phòng (mục **Map đối kháng**):

| Map | Đặc điểm |
|---|---|
| 🌸 **Đền Anh Đào** | Sân đá tròn giữa rừng anh đào, cột đá rải đều — map cân bằng |
| 🥋 **Đảo Đại Hội Võ Thuật** | Sàn đấu lát đá giữa biển, khán đài cổ vũ, bục cao ở giữa, rất thoáng — hợp đấu chưởng tầm xa |
| 🏜 **Hoang Mạc Đá Đỏ** | Sân rộng nhất, nhiều cột đá cao 6–14 m để nấp hoặc bay lên nóc phục kích, bụi bay theo gió |
| 🍃 **Làng Ninja Rừng Trúc** | Nhà gỗ nhảy lên mái được, tháp nước, bãi tập cọc gỗ, giếng đá, rừng trúc bao quanh |

Các map là địa điểm tự thiết kế, chỉ lấy cảm hứng từ không khí phim võ thuật/ninja. Thêm map: khai báo trong [shared/arenas.js](shared/arenas.js) (trụ, hộp, điểm hồi sinh) và viết theme giao diện trong [client/js/world.js](client/js/world.js).

## Chế độ bắn súng

Chọn map khi tạo phòng (phe Công luôn xuất phát ở phía nam, phe Thủ ở phía bắc):

- **🏮 Phố Lồng Đèn** (hoàng hôn): 3 con phố dài (trái → điểm B, giữa, phải → điểm A), nhiều góc hẹp.
- **❄ Đền Tuyết Sơn** (tuyết rơi): tường thành có 3 cổng, sân giữa rộng với bệ đá cao + tháp chuông (leo lên bằng bậc thang để bắn từ trên cao), điểm A có ngôi chùa nhỏ, điểm B có nhà kho.

| Phím | Tác dụng |
|---|---|
| Chuột trái / phải | Bắn / ngắm (súng bắn tỉa) |
| `1` `2` `3`, `Q`, lăn chuột | Đổi súng (chính / lục / dao) |
| `R` | Nạp đạn |
| `Ctrl` hoặc `C` | Ngồi: bắn chính xác hơn, đi chậm |
| `Shift` | Đi bộ chậm, không phát ra tiếng bước chân |
| `B` | Mua đồ (Đặt bom) / chọn súng (Sinh tử) |
| `4` | Cầm lựu đạn; bấm tiếp để đổi loại; click để ném |
| `F` | Nhặt súng dưới đất (đổi với súng cùng loại đang cầm) |
| `G` | Vứt súng đang cầm (cho đồng đội) |
| giữ `E` | Cài bom (phe Công, đứng trong điểm A/B) / gỡ bom (phe Thủ) |
| `Tab` / `Enter` | Bảng điểm / chat |

**Đặt bom**
- Cần ít nhất 1 người mỗi phe để bắt đầu; trước đó là giai đoạn khởi động (bắn tự do, hồi sinh liên tục). Người vào giữa vòng sẽ xem người khác chơi và vào ở vòng sau.
- Mỗi vòng: 6 giây chuẩn bị (đứng yên, mua đồ), 1:55 thi đấu. Mua đồ trong khu xuất phát, trong 20 giây đầu vòng.
- Phe Công thắng khi hạ hết phe Thủ hoặc bom nổ (40 giây sau khi cài). Phe Thủ thắng khi hạ hết phe Công (trước khi bom được cài), gỡ được bom (8 giây, có Bộ Gỡ Bom thì 4 giây), hoặc hết giờ.
- Tiền: bắt đầu $800; thắng vòng +$3250; thua vòng +$1400 và thêm $500 cho mỗi vòng thua liên tiếp; hạ địch được thưởng tuỳ súng; cài bom +$300.
- Sống sót qua vòng thì giữ nguyên súng. Đổi phe sau 6 vòng, thắng 7 vòng là thắng trận. Không bắn được đồng đội.

**Sinh tử**: hồi sinh sau ~2 giây ở chỗ xa kẻ địch, 1.5 giây bất tử khi vừa hồi sinh. Đạt 30 mạng hạ hoặc hết 10 phút thì kết thúc trận.

**Lựu đạn** (mua trong menu, ô số 4). Lựu đạn nảy khi chạm tường/đất và nổ sau khoảng 1,5 giây:

| Loại | Giá | Tối đa | Tác dụng |
|---|---|---|---|
| 💥 Lựu Đạn Nổ | $300 | 1 | Sát thương vùng bán kính 7m (tối đa ~98), tường chắn được, không gây sát thương đồng đội |
| ⚡ Lựu Đạn Choáng | $200 | 2 | Làm trắng màn hình; nhìn thẳng thì bị lâu (~3,5s), quay lưng thì nhẹ; ảnh hưởng cả đồng đội |
| ☁ Lựu Đạn Khói | $300 | 1 | Màn khói che tầm nhìn 15 giây (che cả tên địch khi ngắm qua khói) |

Ở chế độ Sinh tử, mỗi lần hồi sinh được 1 lựu đạn nổ + 1 lựu đạn choáng (không mua thêm được).

**Súng rơi**: người chết làm rơi súng tốt nhất (súng chính, nếu không có thì súng lục). Đi qua là tự nhặt nếu ô súng đó đang trống; nhấn `F` để đổi lấy súng đang cầm. Mua súng mới thì súng cũ cùng ô rơi xuống, nên có thể mua giúp đồng đội rồi vứt (`G`) cho họ. Súng trên đất được giữ qua các vòng, xoá khi đổi phe; ở Sinh tử súng tự biến mất sau 25 giây.

**Cơ chế bắn**: headshot sát thương gấp ~4 lần; giáp + mũ giảm sát thương (súng mạnh xuyên giáp tốt hơn); sát thương giảm dần theo khoảng cách; đứng yên, ngồi hoặc đi bộ (`Shift`) thì bắn chuẩn, chạy càng nhanh đạn càng tản (chạy hết tốc mới tản nhiều; tiểu liên và shotgun ít bị ảnh hưởng), nhảy thì tản rộng; vòng tâm xanh giãn ra đúng bằng độ tản thật, kể cả khi ngắm scope mà vẫn di chuyển; bắn liên tục thì súng giật lên.

Súng: P9 Lục Tiêu, Đại Bàng .50, Ong Vò Vẽ (tiểu liên), Sấm Sét 12 (shotgun), Hổ Vằn AR, Rồng Xanh K4, Diều Hâu SR (bắn tỉa). Thông số trong [shared/weapons.js](shared/weapons.js), map trong [shared/maps.js](shared/maps.js) (map là danh sách khối hộp nên dễ chỉnh hoặc thêm map mới).

## Chơi trên điện thoại

Mở cùng link như máy tính (ví dụ `http://192.168.1.136:3000`), điện thoại phải dùng cùng Wi-Fi hoặc dùng link tunnel. Giao diện cảm ứng tự bật trên điện thoại (có thể bật/tắt trong Cài đặt).

- **Nửa trái màn hình**: chạm ở đâu thì joystick hiện ở đó để di chuyển (đẩy nhẹ là đi chậm).
- **Nửa phải**: vuốt để xoay camera / ngắm.
- **Đối kháng**: mỗi chiêu có nút riêng, không cần bấm combo.
- **Bắn súng**: giữ nút 🎯 để bắn, vừa giữ vừa kéo để ngắm. Nút 💥 cầm lựu đạn (bấm tiếp đổi loại, rồi bấm 🎯 để ném), nút ✋ nhặt súng.
- Nút ☰ mở menu (toàn màn hình, đổi phe, rời phòng); 🏆 bảng điểm; 💬 chat; 🛒 mua đồ.
- Nên xoay ngang máy. Trên điện thoại game tự để đồ hoạ ở mức Thấp cho mượt.

## Nhân vật

Các nhân vật là **nhân vật nguyên bản** theo các hình mẫu quen thuộc của anime/manga:

Ở menu, chọn một nhân vật để xem **bảng chỉ số** (máu, sát thương, tầm đánh, khống chế, cơ động) và **xem trước từng chiêu**: khung 3D tự diễn lần lượt 5 chiêu, bấm vào một dòng chiêu để xem riêng chiêu đó.

| Nhân vật | Máu | Phong cách | Chiêu nổi bật |
|---|---|---|---|
| **Kaze** — Phong Nhẫn Giả | 145 | Ninja gió, nhanh nhẹn | Phi tiêu, Phong Cầu Xoáy, Lốc Phong Đao, tuyệt kỹ lốc xoáy hút đối thủ |
| **Raiga** — Khí Công Quyền Vương | 155 | Võ sĩ tóc vàng dựng đứng | Khí đạn liên thanh, Chưởng Phong Ba (tia năng lượng), Tinh Cầu Hủy Diệt |
| **Homura** — Hỏa Kiếm Cơ | 150 | Nữ kiếm sĩ lửa | Sóng lửa trăng khuyết, Thăng Long Hỏa, Hỏa Trụ Liên Hoàn, Phượng Hoàng Giáng Thế |
| **Yuki** — Băng Tuyết Pháp Sư | 145 | Pháp sư băng | Băng tiễn làm chậm, gai băng, kết giới đóng băng, mưa băng |
| **Shiden** — Lôi Thương Kỵ Sĩ | 145 | Kỵ sĩ cầm thương sét, tầm đánh xa | **Nội tại Tích Điện:** trúng 3 đòn thì sét nảy sang đối thủ gần đó. Lôi tiễn xuyên thấu, lướt sét, Lôi Võng Trận, tuyệt kỹ **Lôi Long Xuyên** (phóng thương rồi dịch chuyển tới chỗ thương cắm, nổ sét choáng) |
| **Midori** — Mộc Linh Sư | 145 | Pháp sư cây cỏ, khống chế + hỗ trợ | Gai độc làm chậm, rễ cây trói, **Gieo Hạt** (bẫy tồn tại 15 s, tối đa 3, giẫm vào bị trói), tuyệt kỹ **Thần Mộc** (cây lớn chắn đạn 9 s, hồi máu cho bạn và đồng đội đứng gần) |
| **Gantetsu** — Thiết Quyền Hộ Vệ | 165 | Võ sĩ đá to con, chậm, trâu | Ném đá tảng (nổ), húc vai đá lăn, **Thiết Bích** (4 s giảm 40% sát thương, không bị đẩy/choáng), tuyệt kỹ **Sơn Băng** (nhảy tới chỗ tâm ngắm đập đất, dựng vòng cột đá 6 s) |
| **Kage** — Ảnh Sát Thủ | 120 | Sát thủ bóng tối, chạy nhanh nhất, ít máu nhất | Phi đao để lại dấu bóng, **Thuấn Ảnh** (dịch chuyển tới dấu phi đao), **Ẩn Thân** (tàng hình 3.5 s, đòn đầu ×1.6), vòng xoáy hắc đao lái theo tâm |

### Thêm / sửa nhân vật

Mọi thứ nằm trong [shared/characters.js](shared/characters.js):

- `hp`: máu tối đa riêng (mặc định 150). Nhân vật to con/chậm nhiều máu hơn, nhân vật nhanh/sát thương cao ít máu hơn.
- `look`: màu da, tóc, kiểu tóc (`spiky`, `superSpiky`, `ponytail`, `long`, `short`, `braids`, `mohawk`, `hooded`), trang phục, phụ kiện (`scarf`, `belt`, `sash`, `hat`, `pauldrons`, `flowerCrown`, `mask`), vũ khí (`kunai`, `katana`, `staff`, `spear`, `gauntlet`, `branch`, `dagger`, `none`), `scale` (to/nhỏ, chỉ đổi hình).
- `skills`: mỗi chiêu có `combo`, `mana`, `cd` (hồi chiêu), `dmg`, `type` (`melee`, `projectile`, `dash`, `beam`, `aoe`, `line`, `rain`) và `fx` (màu + kiểu hiệu ứng).

Thông số chung (máu, mana, tốc độ hồi, tốc độ chạy, đấu trường...) ở [shared/config.js](shared/config.js).

## Cấu trúc thư mục

```
server/   index.js (HTTP + WebSocket + lobby), room.js (đối kháng), shooter.js (bắn súng: vòng đấu, tiền, bom), upnp.js, tunnel.js
shared/   config.js, characters.js, arenas.js (map đối kháng), steer.js, weapons.js, maps.js (map bắn súng)  — dùng chung cho server và client
client/   index.html, style.css, js/ (game, chibi, effects, world, ui, audio, net, touch, main)
          js/shooter/ (sgame: lõi bắn súng, mapview: dựng map, guns: mô hình súng)
```

## Ghi chú kỹ thuật

- Server tick 30 Hz (vòng lặp bù lệch timer Windows), gửi snapshot 30 Hz; client gửi vị trí 30 Hz, người chơi khác được nội suy trễ 70 ms. Gói tin WebSocket được nén (permessage-deflate). Chỉnh trong `NET` ở `shared/config.js`.
- Chiêu thức được hiển thị ngay khi bấm (dự đoán phía client), server xác nhận và tính trúng/sát thương.
- Cài đặt đồ hoạ (Thấp/Trung bình/Cao, bloom) trong menu Cài đặt — chọn "Thấp" cho máy yếu.
