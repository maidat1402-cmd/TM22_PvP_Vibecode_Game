# Chibi Clash ⚔

> **TM22 PvP Vibecode Game** — Your go-to vibe-coded game for post-work relaxation.

Game 3D nhân vật chibi, chơi nhiều người qua phòng (room), chạy trên trình duyệt máy tính **và điện thoại**. Server Node.js rất nhẹ.

Có 5 chế độ, chọn khi tạo phòng:

| Chế độ | Mô tả |
|---|---|
| ⚔ **Đối kháng** | Góc nhìn thứ 3, tung chiêu thức theo combo phím, máu + mana, ai cũng là đối thủ |
| 👥 **Đấu đội** | Như Đối kháng nhưng chia 2 đội Xanh / Đỏ, có phòng chờ, chủ phòng bấm bắt đầu |
| 🎯 **Đấu tập** | Như Đối kháng nhưng có sẵn 2 bia tập và 1 võ sĩ máy: chơi một mình vẫn luyện chiêu và biến hình được |
| 💣 **Đặt bom** | Bắn súng góc nhìn thứ nhất, 2 phe Công (Hắc Long) / Thủ (Thiên Ưng), theo vòng, có mua đồ và tiền thưởng |
| 🔫 **Sinh tử** | Bắn súng tự do, ai cũng là đối thủ, hồi sinh nhanh, súng miễn phí |

- **Đồ hoạ**: nhân vật chibi dựng từ khối cơ bản + toon shading + viền đen; chiêu thức dùng particle GPU, shader năng lượng, vòng phép thuật, tia, lốc xoáy, cột lửa, mưa băng, bloom.
- **Nhẹ**: không có file model/texture/âm thanh nào — tất cả được sinh bằng code (âm thanh tổng hợp bằng WebAudio). Toàn bộ client khoảng 370 KB code chưa nén + three.js, không có bước build.
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
| `L`→`L` | **Dị biến** (khi thanh dị biến đầy) |
| `H` | Hồi máu (tốn mana, có hồi chiêu) |
| giữ `U` | Vận khí: hồi mana rất nhanh nhưng phải đứng yên |
| `P` | Chỉ ở **Đấu tập**: nạp đầy thanh dị biến ngay (điện thoại: menu ☰ → ⚡ Nạp đầy thanh dị biến) |
| `Tab` / `Enter` / `F1` / `Esc` | Bảng điểm / chat / hướng dẫn / menu |

Combo là chuỗi phím bấm liên tiếp nhanh (cách nhau dưới 0.5 giây). Chiêu tự khoá mục tiêu gần tâm màn hình nhất và **ngắm cả theo chiều dọc**: đối thủ đang bay cao (hoặc mình đang bay bắn xuống) thì đạn, tia chưởng bay chếch thẳng tới ngực đối thủ. Không khoá được ai thì ngẩng camera lên để bắn chếch lên trời.

**Chuỗi đòn J:** bấm `J` (hoặc nút ⚔ trên điện thoại) 3 lần liên tiếp, đòn thứ 3 thành **đòn kết** riêng của mỗi nhân vật: Kaze phóng kunai xuyên thấu, Raiga đấm hất tung, Homura xoay kiếm lửa, Yuki chém băng làm chậm, Shiden đâm thương dài (thêm 2 dấu điện), Midori quấn dây leo (choáng), Gantetsu đập đất, Kage đâm sau lưng (×2.2 sát thương nếu đứng sau đối thủ).

**Dị biến:** thanh vàng dưới thanh mana bắt đầu trận ở 0 và chỉ tăng khi **đánh trúng đối thủ** (1 sát thương = 1 điểm). Đầy 100 điểm thì bấm `L` `L` (điện thoại: nút ⚡) để biến hình: 0.8 giây bất tử, sóng xung kích hất văng người xung quanh, hồi đầy mana, rồi **17 giây** ở dạng siêu cấp. Trong lúc dị biến cả 6 chiêu (kể cả đánh thường và đòn kết JJJ) đổi sang bộ chiêu mới, chạy nhanh hơn 15%, hồi mana gấp đôi, có nội tại riêng; tuyệt kỹ JKL tụ lực lâu hơn hẳn (1.2–1.4 giây, dễ bị ngắt nếu đứng gần đối thủ). Hết giờ thì kiệt sức 2 giây (chạy chậm). Đang dị biến không tích thanh; chết mất một nửa thanh. Bảng tên trên đầu mọi người có vạch vàng cho biết thanh dị biến, đầy thì hiện ⚡.

| Nhân vật | Dạng dị biến | Nội tại khi biến hình | Bộ chiêu mới (J · K · JK · KL · JKL) |
|---|---|---|---|
| Kaze | **Phong Thần Hóa**: khăn tách thành 4 dải gió | **Bay tự do** không tốn mana: giữ `Space` (điện thoại: giữ nút Nhảy/Bay) là bay, cao tối đa 10 m, thả ra thì lượn chậm xuống; ra chiêu được giữa không trung. Chạy nhanh hơn 25%, lướt né hồi nhanh gấp đôi. Đang ở trên không thì nhận thêm 15% sát thương | Lưỡi gió bay · 5 phi tiêu tự tìm mục tiêu · **lướt 3 chiều** theo hướng ngắm (lên trời, bổ xuống), lướt xuyên qua ai thì 0.4 s sau **phân thân gió** chém thêm 1 nhát · **tường gió** chặn đạn đối thủ (đạn mình bay xuyên), bước vào chân tường thì được gió đẩy bay vọt lên · cưỡi **rồng lốc** 2.2 s lái theo tâm cả hướng lẫn độ cao (ngẩng camera để bay lên, nhìn xuống để bổ nhào) |
| Raiga | **Bạo Khí Thân**: vân dung nham, găng khí khổng lồ | Không bị đẩy lùi, giảm 15% sát thương. **Giữ phím để tụ khí**: giữ `K` (hoặc giữ `L` khi bấm `K` `L`) rồi thả, giữ càng lâu càng to và mạnh (K tối đa 1.5 s: sát thương ×2.2; chưởng tối đa 1.2 s: ×1.8, tia to gấp đôi). Lúc tụ khí phải đứng yên | Khí quyền bay 7 m · **Tụ Khí Đạn** · **Bạo Trảo Quăng**: lao tới túm đối thủ đầu tiên trúng, nhấc bổng lên, quật xuống đất (choáng) rồi ném văng theo hướng nhìn (không túm được người đang bất tử hoặc không bị đẩy lùi) · chưởng 2 s quét theo tâm, giữ L để tụ · lao tới đấm loạn rồi nổ khí tung lên trời |
| Homura | **Viêm Hoàng Giáp**: cánh lửa, vương miện lửa | Mọi đòn gây **bỏng**. **Đất cháy**: bước chạy, nhát chém J và cú bổ JK để lại vệt lửa trên sàn 3 giây; đối thủ đứng vào bị bỏng (nhảy qua thì không), Homura đứng trên lửa hồi mana nhanh hơn. **Hồi sinh 1 lần**: gục khi đang biến hình thì sống lại tại chỗ với 30% máu, hết dị biến | Chém để lại vệt lửa · **Hồi Nguyệt Viêm**: trăng lửa bay 13 m rồi quay về như boomerang, trúng cả lượt đi lẫn lượt về · bay lên bổ xuống, chỗ đáp thành vũng lửa 4 m · vòng lửa bám theo người · **Phượng Hoàng Niết Bàn**: phượng hoàng lao theo tâm, mọi vệt lửa trên sàn cùng bùng thành cột lửa |
| Yuki | **Băng Hậu**: vương miện, áo choàng băng | Trúng 3 đòn trong 3 s thì **đóng băng** 1 s. **Sàn băng**: chiêu đóng băng mặt sàn; đối thủ đứng trên băng bị trơn trượt, rất khó dừng và đổi hướng (nhảy, bay thì không sao); Yuki trên băng của mình chạy nhanh hơn 30% | Băng đạn, chỗ trúng đóng băng sàn · 3 băng thương xuyên · trượt băng để lại vệt băng · **Băng Tường**: tường băng cong 5 khối chắn đường và chắn đạn của cả hai bên, mỗi khối 25 máu, bị đập vỡ thì mảnh băng làm chậm người đứng gần · **Thời Băng Giới**: vùng 10 m quanh Yuki 4 giây, đối thủ và đạn của đối thủ đi vào chậm 60%, sàn thành băng, mất máu theo nhịp, hết giờ băng vỡ tung làm choáng |
| Shiden | **Lôi Kỵ Thần**: sừng vàng, giáp sáng điện | Chỉ cần 2 dấu điện là sét nảy. **Cọc sét**: tối đa 3 cọc, mỗi cọc 8 giây, 30 máu (đối thủ đánh vỡ được). Hai cọc cách nhau dưới 10 m nối thành **hàng rào điện**: đối thủ đi xuyên qua bị giật 8 sát thương + 1 dấu điện, nhảy qua thì né được | Thương đâm 4.6 m · **phóng thương**: trúng người thì gây sát thương, trượt thì cắm xuống chỗ rơi thành cọc sét · **Lôi Độn**: dịch chuyển tới cọc gần tâm ngắm nhất (không có cọc thì dịch chuyển 10 m), sét giáng quanh chỗ tới · lưới sét kéo vào giữa, mọi cọc trong 16 m cũng phóng vòng sét kéo người về phía cọc · **Thiên Lôi Phán Quyết**: sét giáng mọi đối thủ trong 22 m (+10 mỗi dấu điện), mỗi cọc phóng thêm 1 tia vào đối thủ gần nó |
| Midori | **Hồn Rừng**: sừng cành cây, hoa mọc khắp người | **Hút máu** 12% sát thương gây ra. Sức mạnh nằm ở cây cối cô trồng: cây và người cây đối thủ đánh phá được | Roi gai kéo đối thủ về · gai nổ chùm · **Trồng Gai Đài**: cây bắn gai (tối đa 2 cây, 10 giây, 40 máu) tự bắn gai làm chậm vào đối thủ gần nhất trong 12 m · thảm hoa hồi máu · **Mộc Thần Hộ Vệ**: người cây cao 3 m trồi lên (hất tung đối thủ quanh đó), đi theo Midori 10 giây, tự đấm đối thủ gần và lấy thân chặn đạn (130 máu) |
| Gantetsu | **Sơn Thần Giáp**: giáp đá, to ×1.3 | Giảm 30% sát thương, không bị đẩy, không bị choáng (không được tăng tốc chạy). **Cột đá**: tối đa 3 cột, mỗi cột 10 giây, 60 máu, chắn đường và chắn đạn, đứng lên nóc được | Đấm chấn động hình nón · **Nhổ Sơn Thạch**: có cột đá của mình trong 10 m thì nhổ cột đó lên ném (to, nổ rộng), không có thì ném cự thạch · cuộn đá lăn · **Dựng Sơn Trụ**: cột đá cao 4 m trồi lên ở tâm ngắm (tầm 14 m), trồi dưới chân đối thủ thì hất tung, dưới chân mình thì nâng mình lên nóc · **Địa Chấn Toàn Sân**: tụ lực 1.4 s rồi dậm đất, mọi đối thủ đang đứng trên mặt đất trong 25 m bị choáng 1.2 s; ai đang ở trên không (nhảy, bay, đứng trên cột đá) thì **né được**. Cột đá vỡ tung bắn mảnh đá |
| Kage | **Vạn Ảnh**: thân bóng đen mắt đỏ, 2 phân thân | Mọi đòn đánh sau lưng ×1.5 | Chém + **2 phân thân chém theo** · mưa phi đao · **Hoán Ảnh**: đổi chỗ với phân thân mồi gần tâm ngắm (không có thì dịch chuyển ra sau lưng đối thủ) · **Phân Ảnh Mồi**: tàng hình 1 s và thả 2 phân thân giống hệt mình (cùng tên, cùng thanh máu) chạy chéo về phía trước 5 giây; đối thủ thấy như người thật, chiêu tự khoá có thể nhắm nhầm; trúng 1 đòn là tan, nổ bóng làm chậm · **Vạn Ảnh Táng**: lướt chém lần lượt 5 nhát, kèm **sương đêm**: đối thủ trong 15 m chỉ nhìn thấy người (và tên) trong 6 m suốt 4 giây |

**Lái tuyệt kỹ theo tâm:** trong lúc tuyệt kỹ còn hiệu lực, xoay chuột (điện thoại: giữ nút ★ rồi kéo, hoặc vuốt nửa phải màn hình) để điều khiển chiêu theo vòng tâm; một vòng sáng trên mặt đất cho biết điểm đang lái tới. Lốc xoáy (Kaze), mưa băng (Yuki) và vòng xoáy hắc đao (Kage) trôi theo tâm; Tinh Cầu Hủy Diệt (Raiga) và cây thương của Lôi Long Xuyên (Shiden) bẻ hướng bay cả lên/xuống; Phượng Hoàng (Homura) uốn cong đường lao. Ở dạng dị biến: rồng lốc (Kaze, lái cả độ cao), đường lao Bách Liệt Bạo Quyền (Raiga), phượng hoàng khổng lồ (Homura) lái theo tâm; rừng gai (Midori) trôi theo tâm; chưởng Bạo Long Chưởng (Raiga, KL) quét theo tâm cả chiều ngang lẫn chiều dọc. Tốc độ lái chỉnh ở `steer` của từng chiêu trong `shared/characters.js`.

**Máu & mana**: máu tự hồi chậm sau 5 giây không bị đánh; hồi nhanh hơn bằng chiêu Hồi Máu. Mana tự hồi nhanh hơn máu, vận khí (giữ U) hồi rất nhanh. Chiêu càng mạnh càng tốn nhiều mana và hồi chiêu lâu. Hết máu sẽ gục và hồi sinh sau 4 giây.

### Đấu tập

Tạo phòng ở chế độ **🎯 Đấu tập** (chọn map như Đối kháng). Trong phòng có sẵn:

- **2 bia tập** 🎯 đứng yên, bị đánh văng thì tự đi về chỗ cũ, 2.5 giây không bị đánh thì hồi đầy máu.
- **1 võ sĩ máy** 🤖 (nhân vật ngẫu nhiên) chạy vòng quanh bạn, thỉnh thoảng nhảy, đánh thường và bắn chiêu K (sát thương giảm một nửa). Hợp để thử ngắm dọc, thử né.
- Bấm `P` (điện thoại: menu ☰ → **⚡ Nạp đầy thanh dị biến**) để nạp đầy thanh dị biến ngay, rồi `L` `L` để biến hình.

Bạn bè vẫn vào phòng đấu tập được như phòng thường. Người thật cuối cùng rời đi thì phòng tự xoá.

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
- **Đối kháng**: mỗi chiêu có nút riêng, không cần bấm combo. Nút ⚡ (góc trên bên phải cụm nút) sáng lên khi thanh dị biến đầy, bấm để biến hình. Chiêu tụ lực của Raiga dị biến: giữ nút rồi thả để bắn.
- **Bắn súng**: giữ nút 🎯 để bắn, vừa giữ vừa kéo để ngắm. Nút 💥 cầm lựu đạn (bấm tiếp đổi loại, rồi bấm 🎯 để ném), nút ✋ nhặt súng.
- Nút ☰ mở menu (toàn màn hình, đổi phe, rời phòng); 🏆 bảng điểm; 💬 chat; 🛒 mua đồ.
- Nên xoay ngang máy. Trên điện thoại game tự để đồ hoạ ở mức Thấp cho mượt.

## Nhân vật

Cả 8 nhân vật đều **tự sáng tác**: tên, ngoại hình và chiêu thức chỉ lấy cảm hứng chung từ các hình mẫu quen thuộc (ninja gió, kiếm sĩ lửa, pháp sư băng…), không mô phỏng nhân vật có bản quyền nào.

Ở menu, chọn một nhân vật để xem **bảng chỉ số** (máu, sát thương, tầm đánh, khống chế, cơ động) và **xem trước từng chiêu**: khung 3D tự diễn lần lượt 6 chiêu thường rồi biến hình và diễn 6 chiêu dị biến, bấm vào một dòng chiêu để xem riêng chiêu đó.

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

Tên chiêu thường của từng nhân vật:

| Nhân vật | `J` | `K` | `J` `K` | `K` `L` | `J` `K` `L` ★ | `J` `J` `J` (đòn kết) |
|---|---|---|---|---|---|---|
| Kaze | Kunai Liên Trảm | Phi Tiêu Phong Ấn | Phong Cầu Xoáy | Lốc Phong Đao | Đại Phong Long Quyển | Phi Kunai Tuyệt Ảnh |
| Raiga | Liên Hoàn Quyền | Khí Đạn | Thiểm Quang Quyền | Chưởng Phong Ba | Tinh Cầu Hủy Diệt | Thăng Thiên Quyền |
| Homura | Viêm Kiếm Trảm | Viêm Nguyệt Trảm | Thăng Long Hỏa | Hỏa Trụ Liên Hoàn | Phượng Hoàng Giáng Thế | Viêm Long Toàn Trảm |
| Yuki | Băng Trượng Kích | Băng Tiễn Phong Bạo | Băng Phong Lộ | Hàn Băng Kết Giới | Thiên Băng Vũ | Băng Phong Kích |
| Shiden | Lôi Thương Đâm | Lôi Tiễn | Lôi Ảnh Bộ | Lôi Võng Trận | Lôi Long Xuyên | Lôi Thương Toàn Kích |
| Midori | Đằng Tiên Quất | Gai Độc Phi Châm | Rễ Thần Trói Buộc | Gieo Hạt Trói Thân | Thần Mộc Giáng Thế | Đằng Mạn Triền Thân |
| Gantetsu | Thiết Quyền | Phi Thạch | Thiết Kiên Xung | Thiết Bích Thân | Sơn Băng Địa Liệt | Địa Liệt Quyền |
| Kage | Ảnh Trảm | Ảnh Phi Đao | Thuấn Ảnh Bộ | Ẩn Thân Thuật | Hắc Liên Loạn Trảm | Bối Ảnh Thích |

Tên chiêu ở dạng dị biến:

| Nhân vật | `J` | `K` | `J` `K` | `K` `L` | `J` `K` `L` ★ |
|---|---|---|---|---|---|
| Kaze | Phong Nhận | Bão Phi Tiêu | Phong Ảnh Bộ | Thiên Phong Bích | Phong Long Thiên Hành |
| Raiga | Khí Quyền | Tụ Khí Đạn | Bạo Trảo Quăng | Bạo Long Chưởng | Bách Liệt Bạo Quyền |
| Homura | Viêm Hoàng Trảm | Hồi Nguyệt Viêm | Viêm Long Trụy | Hỏa Luân Trận | Phượng Hoàng Niết Bàn |
| Yuki | Băng Tinh Đạn | Băng Thương Xuyên | Băng Hoạt Bộ | Băng Tường | Thời Băng Giới |
| Shiden | Lôi Thần Thương | Lôi Trụ Thương | Lôi Độn | Lôi Võng Thiên La | Thiên Lôi Phán Quyết |
| Midori | Gai Tiên Câu | Gai Hoa Nổ | Trồng Gai Đài | Hoa Viên Hồi Xuân | Mộc Thần Hộ Vệ |
| Gantetsu | Chấn Sơn Quyền | Nhổ Sơn Thạch | Sơn Thạch Cuộn | Dựng Sơn Trụ | Địa Chấn Toàn Sân |
| Kage | Vạn Ảnh Trảm | Ảnh Đao Vũ | Hoán Ảnh | Phân Ảnh Mồi | Vạn Ảnh Táng |

Đòn kết `J` `J` `J` ở dạng dị biến là bản cường hóa của đòn kết thường (sát thương ×1.5, tên thêm hậu tố "· Cực").

### Thêm / sửa nhân vật

Mọi thứ nằm trong [shared/characters.js](shared/characters.js):

- `hp`: máu tối đa riêng (mặc định 150). Nhân vật to con/chậm nhiều máu hơn, nhân vật nhanh/sát thương cao ít máu hơn.
- `look`: màu da, tóc, kiểu tóc (`spiky`, `superSpiky`, `ponytail`, `long`, `short`, `braids`, `mohawk`, `hooded`), trang phục, phụ kiện (`scarf`, `belt`, `sash`, `hat`, `pauldrons`, `flowerCrown`, `mask`), vũ khí (`kunai`, `katana`, `staff`, `spear`, `gauntlet`, `branch`, `dagger`, `none`), `scale` (to/nhỏ, chỉ đổi hình).
- `skills`: mỗi chiêu có `combo`, `mana`, `cd` (hồi chiêu), `dmg`, `type` và `fx` (màu + kiểu hiệu ứng). Kiểu chiêu có sẵn: `melee`, `projectile`, `dash`, `beam`, `aoe`, `line`, `rain`, `trap` (bẫy), `summon` (vật triệu hồi), `leap` (nhảy tới tâm ngắm), `blink` (dịch chuyển), `buff`; riêng dạng dị biến có thêm `wall` (tường chắn đạn), `smite` (sét giáng mọi đối thủ trong tầm), `multiblink` (lướt chém nhiều nhát), `pillar` (dựng cột đá), `quake` (động đất cả sân).
- `passive`: nội tại của dạng thường (hiện chỉ Shiden có Tích Điện).
- `awaken` (bảng `AWAKEN` cuối file): tên, `form` (ngoại hình, dựng trong `client/js/chibi.js` → `buildForm`), `look` (màu đè lên), `passive` (nội tại) và 6 chiêu dị biến. Thông số chung của dị biến (100 điểm, 17 giây…) ở `AWAKEN` trong `shared/config.js`.

Thông số chung (máu, mana, tốc độ hồi, tốc độ chạy, đấu trường...) ở [shared/config.js](shared/config.js).

## Cấu trúc thư mục

```
server/   index.js (HTTP + WebSocket + lobby), room.js (đối kháng + đấu đội), shooter.js (bắn súng: vòng đấu, tiền, bom),
          loop.js (vòng lặp tick bù lệch timer), upnp.js, tunnel.js
shared/   config.js, characters.js (nhân vật + dị biến), arenas.js (map đối kháng), steer.js, weapons.js, maps.js (map bắn súng)
          — dùng chung cho server và client
client/   index.html, style.css, js/ (game, chibi, effects, world, ui, audio, net, touch, main)
          js/shooter/ (sgame: lõi bắn súng, mapview: dựng map, guns: mô hình súng)
tests/    awaken.mjs (kiểm tra dị biến và ngắm dọc qua WebSocket)
```

## Kiểm tra khi phát triển

- Mở nhanh để test: `http://localhost:3000/?quick&mode=brawl&map=shrine` (chế độ `brawl`, `practice`, `bomb`, `dm`; map đối kháng `shrine`, `tournament`, `wasteland`, `village`; map bắn súng `lantern`, `temple`). `/?room=<ID>` vào phòng có sẵn.
- Test dị biến và đấu tập: chạy `node server/index.js --port 3123` rồi `node tests/awaken.mjs` (cần Node ≥ 22 vì dùng `WebSocket` có sẵn, mất khoảng 5 phút).
- Quy tắc đóng góp (commit, cân bằng, mạng, đồ hoạ) xem ở [AGENTS.md](AGENTS.md).
- Số phiên bản hiện ở góc dưới menu và trong bảng tạm dừng (Esc). Lịch sử thay đổi theo từng phiên bản ở [CHANGELOG.md](CHANGELOG.md). Nếu thấy dòng chữ đỏ `vX ≠ server vY` thì trình duyệt đang chạy bản cũ: tải lại trang.

## Ghi chú kỹ thuật

- Server tick 30 Hz (vòng lặp bù lệch timer Windows), gửi snapshot 30 Hz; client gửi vị trí 30 Hz, người chơi khác được nội suy trễ 70 ms. Gói tin WebSocket được nén (permessage-deflate). Chỉnh trong `NET` ở `shared/config.js`.
- Chiêu thức được hiển thị ngay khi bấm (dự đoán phía client), server xác nhận và tính trúng/sát thương.
- Cài đặt đồ hoạ (Thấp/Trung bình/Cao, bloom) trong menu Cài đặt — chọn "Thấp" cho máy yếu.
