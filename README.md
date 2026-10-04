# Device Scanner

Bir bilgisayarda **bir server ve üç bağımsız Raspberry Pi node'u** gibi çalışan küçük bir Python projesi. Bilgisayardaki node'lar sahte tarama verisi üretir. Raspberry Pi'ye aynı kaynak kodu aktarılır; `--scanner real` ile gerçek Bluetooth/BLE ve Wi-Fi taraması kullanılır.

```text
Tarayıcı ──► Server :8001 ◄── pi-01
                         ◄── pi-02
                         ◄── pi-03
```

Python 3.11+ gerekir. Server ve dummy node'lar yalnız Python standart kütüphanesini kullanır.

## Hemen başlat

```bash
cd /home/gz/device-scanner
python3 -m venv .venv
.venv/bin/python -m device_scanner dev
```

Tarayıcıdan **http://127.0.0.1:8001** adresini aç. Üç node'un bağlantısını, Bluetooth/Wi-Fi sonuçlarını ve hata durumlarını görebilirsin. **Ctrl+C** bu komutun başlattığı bütün süreçleri kapatır.

Node sayısını veya portu değiştirmek için:

```bash
.venv/bin/python -m device_scanner dev --nodes 5 --port 8002
```

Her node ayrı bir işletim sistemi sürecidir. Başlangıçta yazılan PID'lerden birini `kill PID` ile durdurabilirsin: diğer node'lar çalışmaya devam eder. Varsayılan geliştirme ayarlarında duran node yaklaşık 6 saniye sonra çevrimdışı görünür. Bu ortam Pi işletim sistemini veya radyo donanımını taklit etmez; aynı uygulama kodunun çoklu cihaz davranışını çalıştırır.

Dummy Wi-Fi ve Bluetooth sinyalleri her taramada küçük rastgele değişimler ve ara sıra daha belirgin düşüşler üretir. RSSI −100 ile −25 dBm arasında kalır; örnek konum doğruluğu da hafifçe değişir. Cihaz kimlikleri ve `FirstSeen` sabit kaldığından sinyal grafiğini aynı cihaz üzerinde izleyebilirsin.

## Süreçleri ayrı terminallerde çalıştır

Her terminalde proje klasörüne geç. Önce server:

```bash
.venv/bin/python -m device_scanner server
```

İkinci terminalde bir node:

```bash
.venv/bin/python -m device_scanner node --id pi-01 --scanner dummy
```

Üçüncü terminalde başka bir node:

```bash
.venv/bin/python -m device_scanner node --id pi-02 --scanner dummy
```

Her node'un kimliği farklı olmalı. Elle başlatılan server için çevrimdışı eşiği varsayılan 60 saniyedir; `--offline-after 10` ile değişir. Bu eşik heartbeat aralığından büyük olmalı.

Server'ı kapatıp yeniden açabilirsin. Node'lar ağ hatasını bildirir ve sonraki güncel raporlarını göndermeyi sürdürür; eski raporları biriktirmez. Server yeniden başlayınca canlı liste yeni raporlarla oluşur.

## Raspberry Pi'ye aktar

Proje klasörünü Pi'ye kopyala. Örneğin proje klasöründen, `USER` ve `PI_IP` değerlerini değiştirerek:

```bash
rsync -av --exclude='.venv' --exclude='.git' --exclude='__pycache__' \
  ./ USER@PI_IP:~/device-scanner/
```

`.venv` taşınmaz; her Pi'de yeniden oluşturulur. 64-bit Raspberry Pi OS ve Python 3.11+ kullan.

### Server Pi

```bash
cd ~/device-scanner
python3 -m venv .venv
.venv/bin/python -m device_scanner server --host 0.0.0.0
```

Tarayıcı adresi `http://SERVER_PI_IP:8001` olur. Server Pi'de radyo bağımlılığı kurulmaz.

### Tarayıcı Pi

Gerçek tarama Linux üzerinde çalışan BlueZ ve NetworkManager servislerini kullanır:

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends python3-venv bluez network-manager iw
cd ~/device-scanner
python3 -m venv .venv
.venv/bin/python -m pip install --only-binary=:all: -r requirements-pi.txt
.venv/bin/python -m device_scanner node \
  --id pi-01 --scanner real --server http://SERVER_PI_IP:8001
```

Bluetooth adaptörü açık ve NetworkManager'ın yönettiği Wi-Fi arayüzü kullanılabilir olmalı. Çalıştıran kullanıcının D-Bus tarama izinleri gerekir; erişim sorunu veya eksik donanım panoda ilgili radyo için hata olarak görünür. Gerçek donanım taraması Pi üzerinde ayrıca doğrulanmalıdır.

Gerekirse tek radyo veya belirli bir adaptör seç:

```bash
.venv/bin/python -m device_scanner node \
  --id pi-02 --scanner real --server http://SERVER_PI_IP:8001 \
  --radios bluetooth --bluetooth-adapter hci0
```

Wi-Fi için `--radios wifi --wifi-interface wlan0` kullanılabilir. Wi-Fi taraması çevredeki **erişim noktalarını** bulur; bunlara bağlı istemcileri listelemez. Bluetooth cihazlarının keşfedilebilir veya BLE yayını yapıyor olması gerekir.

## Küçük kod yapısı

- `device_scanner/server.py`: rapor alıcısı ve bellekteki son durum.
- `device_scanner/static/index.html`: pano sayfasının yapısı.
- `device_scanner/static/styles.css`: görünüm, açık/koyu tema ve mobil düzen.
- `device_scanner/static/js/`: API, filtreleme, Pi listesi, sonuçlar, ayrıntılar ve grafikler için küçük JavaScript modülleri.
- `device_scanner/node.py`: heartbeat, tarama döngüleri ve HTTP gönderimi.
- `device_scanner/wigle.py`: ortak WiGLE alanları, doğrulama ve gerçek donanım verisi dönüşümü.
- `device_scanner/scanners/`: dummy ve gerçek tarayıcılar.
- `device_scanner/dev.py`: ayrı server/node süreçlerini başlatma ve kapatma.

Gerçek Bluetooth/Wi-Fi sürücüleri mevcut `bakici-app` projesindeki tarayıcılardan alınmıştır; bu proje eski klasöre import veya dosya yolu ile bağlı değildir. Geliştirme ve Pi aynı node döngüsünü kullanır, yalnız tarayıcı seçimi ve sunucu adresi değişir.

API: `POST /api/reports`, `GET /api/nodes`, `GET /api/health`. Arayüz görünürken iki saniyede, arka planda on saniyede bir güncellenir. Tarama ve heartbeat aralıkları `--interval`, gerçek tarama süresi `--timeout` ile ayarlanır. Bir radyo hatası diğer radyo veya heartbeat döngüsünü durdurmaz.

## Ortak WiGLE veri biçimi

Dummy ve gerçek Pi'ler aynı [WiGLE v1.6](https://api.wigle.net/csvFormat.html) alanlarını gönderir. Her gözlem doğrudan `MAC`, `SSID`, `AuthMode`, `FirstSeen`, `Channel`, `Frequency`, `RSSI`, `CurrentLatitude`, `CurrentLongitude`, `AltitudeMeters`, `AccuracyMeters`, `RCOIs`, `MfgrId`, `Type` alanlarını içerir. Eski `path/properties` yapısı kaldırılmıştır. Pi kimliği ve radyo bilgisi JSON raporunun dış kısmında kalır.

Her iki radyoda sinyal dBm'dir; Wi-Fi yüzdesi dBm'e çevrilmez. Gerçek Wi-Fi RSSI değeri `iw` tarama önbelleğinden okunur; erişilemiyorsa boş kalır. Gerçek cihazlarda GPS kaynağı olmadığı için konum alanları boştur. Dummy konumlar örnektir. `FirstSeen` UTC'dir ve aynı node süreci boyunca sabit kalır. Bluetooth için `Frequency` MHz değil, cihaz sınıf kodudur.

Bu değişiklikten sonra server ve tüm node'ları birlikte güncelleyip yeniden başlat; ardından tarayıcıyı yenile. Alan açıklamaları, örnek rapor ve donanım sınırlamaları: [WiGLE data format](docs/wigle.md).

## Yeni analiz panosu

Pano, `bakici-app` Pi seçimi/ayrıntı düzeninden ve [Acrylic Wi-Fi Analyzer](https://www.acrylicwifi.com/en/wifi-analyzer/) uygulamasının tablo, sinyal ve kanal görünümlerinden esinlenir. İngilizce arayüz; Pi seçimi, Bluetooth/Wi-Fi geçişi, ad/adres araması, Wi-Fi bant filtresi, sıralama, JSON/CSV dışa aktarma ve açık/koyu tema sunar. Bir satır seçildiğinde WiGLE kaydının tamamı incelenebilir. CSV dosyası WiGLE v1.6 biçimindedir; JSON ayrıca Pi, filtre ve durum bilgisini saklar.

Sinyal grafiği yalnız tarayıcı açıkken gelen yeni raporlardan oluşur; son 60 ölçümü tutar. Kanal grafiği filtrelenen güncel başarılı sonuçlarda aynı BSSID'yi kanal/bant başına bir kez sayar; kanal doluluk oranı veya parazit ölçmez. Tablo her Pi'nin gözlemini ayrı tutar. Hatalı/çevrimdışı Pi'lerin önceki verileri işaretlenir; sunucu kesilirse son görünüm eski olarak gösterilir.

HTML/CSS/JavaScript doğrudan Python sunucusundan sunulur. Uygulamayı çalıştırmak için Node.js, npm kurulumu veya derleme gerekmez. Kodun iş bölümü ve kullanım ayrıntıları: [Frontend guide](docs/frontend.md).

Bu başlangıç sürümü geliştirme ve güvenilen yerel ağ içindir; HTTP üzerinde kimlik doğrulama yoktur. Sonuçlar bellektedir. DHCP, kalıcı kayıt, bina haritası ve otomatik servis kurulumu bu ilk adımın kapsamına dahil değildir.

## Test

```bash
.venv/bin/python -m unittest discover -s tests -v
```

Testler radyo donanımı gerektirmez. Gerçek HTTP ve ayrı süreçlerle üç dummy node, bağlantı kesilmesi/toparlanma ve temiz kapanış da kontrol edilir.

İsteğe bağlı frontend kontrolleri (Node.js 20+; npm paketi gerekmez):

```bash
node --test tests/frontend/*.test.js
node tools/check_browser.mjs
```

Tarayıcı kontrolü kurulu Chrome kullanır; gerekirse `CHROME_BIN=/path/to/chromium` ve `PYTHON=/path/to/python` belirt. Geçici sunucular ve sentetik raporlar oluşturur, test sonunda kapatır. Masaüstü, koyu tema ve mobil ekran görüntülerini `/tmp/device-scanner-{desktop,dark,mobile}.png` konumuna kaydeder.
