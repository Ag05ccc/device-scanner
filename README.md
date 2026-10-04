# Device Scanner

Binadaki **Wi-Fi erişim noktalarını ve Bluetooth yayınlarını** tek ekranda izleyen küçük bir Python projesi. Bir sunucu, farklı katlardaki bağımsız Raspberry Pi sensörlerinden rapor toplar. Geliştirme bilgisayarında aynı düzen dummy node süreçleriyle çalışır; Raspberry Pi'de `--scanner real` gerçek Bluetooth/BLE ve Wi-Fi taramasını kullanır.

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

Tarayıcıdan **http://127.0.0.1:8001** adresini aç. Açılışta bina genelindeki tekil Wi-Fi/Bluetooth kayıtları, gözlem güncelliği, cihaz listesi ve kısa kat özeti görünür. **Ctrl+C** bu komutun başlattığı bütün süreçleri kapatır.

Node sayısını veya portu değiştirmek için:

```bash
.venv/bin/python -m device_scanner dev --nodes 5 --port 8002
```

Tarama aralığını ve ortak kat dosyasını ayrıca seçebilirsin:

```bash
.venv/bin/python -m device_scanner dev --nodes 3 --interval 2 \
  --placements-file .device-scanner/demo-placements.json
```

Her node ayrı bir işletim sistemi sürecidir. Başlangıçta yazılan PID'lerden birini `kill PID` ile durdurabilirsin: diğer node'lar çalışmaya devam eder. Varsayılan geliştirme ayarlarında duran node yaklaşık 6 saniye sonra çevrimdışı görünür. Bu ortam Pi işletim sistemini veya radyo donanımını taklit etmez; aynı uygulama kodunun çoklu cihaz davranışını çalıştırır.

Her dummy Pi başlangıçta **8 Wi-Fi ve 12 Bluetooth adresi** duyar. 3 Wi-Fi ve 5 Bluetooth adresi Pi'ler arasında ortaktır; üç Pi ile bina genelinde başlangıç sayısı **18 Wi-Fi ve 26 Bluetooth** olur. Yedinci taramadan itibaren her radyoya bir yeni yerel adres eklenir. Her 24 taramalık döngünün 12. ve 13. taramalarında bir yerel adres kısa süre görünmez, sonra geri gelir. Ortak adresler, açık/gizli ağlar, farklı Wi-Fi bantları ve Bluetooth türleri tekilleştirme ve durum davranışını denemeye yarar.

Dummy sinyallerinde küçük rastgele değişimler ve ara sıra belirgin düşüşler vardır. RSSI −100 ile −25 dBm arasında kalır; örnek konum doğruluğu da hafifçe değişir. Kimlikler ve `FirstSeen` aynı süreç boyunca sabit kalır. `--nodes` Pi sayısını değiştirir; Pi başına cihaz profilleri [dummy.py](device_scanner/scanners/dummy.py) içindeki ortak/yerel listelerle belirlenir. Ölçümler ve konumlar örnektir; arayüz bunları **Demo** olarak işaretler.

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

Server'ı kapatıp yeniden açabilirsin. Node'lar ağ hatasını bildirir ve sonraki güncel raporlarını göndermeyi sürdürür; eski raporları biriktirmez. Server yeniden başlayınca canlı liste ve geçici cihaz geçmişi yeni raporlarla oluşur. Dosyaya kaydedilen kat yerleşimleri korunur.

## Raspberry Pi'ye aktar

Proje klasörünü Pi'ye kopyala. Örneğin proje klasöründen, `USER` ve `PI_IP` değerlerini değiştirerek:

```bash
rsync -av --exclude='.venv' --exclude='.git' --exclude='__pycache__' --exclude='.device-scanner' \
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

- `device_scanner/server.py`: rapor alıcısı, radyo tazeliği ve API.
- `device_scanner/monitoring.py`: sunucu oturumundaki sınırlı gözlem/kimlik geçmişi.
- `device_scanner/placements.py`: paylaşılan kat yerleşimlerini atomik olarak kaydetme.
- `device_scanner/static/index.html`: pano sayfasının yapısı.
- `device_scanner/static/styles.css`: masaüstü yerleşimi, açık/koyu tema ve dar pencere düzeni.
- `device_scanner/static/js/`: saf cihaz birleştirme (`entities.js`), genel bakış (`overview.js`), cihaz listesi/ayrıntısı (`devices.js`), sensör yönetimi ve teknik analiz için küçük modüller.
- `device_scanner/node.py`: heartbeat, tarama döngüleri ve HTTP gönderimi.
- `device_scanner/wigle.py`: ortak WiGLE alanları, doğrulama ve gerçek donanım verisi dönüşümü.
- `device_scanner/scanners/`: dummy ve gerçek tarayıcılar.
- `device_scanner/dev.py`: ayrı server/node süreçlerini başlatma ve kapatma.

Gerçek Bluetooth/Wi-Fi sürücüleri mevcut `bakici-app` projesindeki tarayıcılardan alınmıştır; bu proje eski klasöre import veya dosya yolu ile bağlı değildir. Geliştirme ve Pi aynı node döngüsünü kullanır, yalnız tarayıcı seçimi ve sunucu adresi değişir.

API: `POST /api/reports`, `GET /api/nodes`, `GET /api/health`, `GET/POST /api/placements`. Arayüz görünürken iki saniyede, arka planda on saniyede bir güncellenir. Tarama ve heartbeat aralıkları `--interval`, gerçek tarama penceresi `--timeout` ile ayarlanır. Bir radyo hatası diğer radyo veya heartbeat döngüsünü durdurmaz. Heartbeat, etkin radyoları ve beklenen çevrimi (`interval + timeout`) bildirir.

## Ortak WiGLE veri biçimi

Dummy ve gerçek Pi'ler aynı [WiGLE v1.6](https://api.wigle.net/csvFormat.html) alanlarını gönderir. Her gözlem doğrudan `MAC`, `SSID`, `AuthMode`, `FirstSeen`, `Channel`, `Frequency`, `RSSI`, `CurrentLatitude`, `CurrentLongitude`, `AltitudeMeters`, `AccuracyMeters`, `RCOIs`, `MfgrId`, `Type` alanlarını içerir. Eski `path/properties` yapısı kaldırılmıştır. Pi kimliği ve radyo bilgisi JSON raporunun dış kısmında kalır.

Her iki radyoda sinyal dBm'dir; Wi-Fi yüzdesi dBm'e çevrilmez. Gerçek Wi-Fi RSSI değeri `iw` tarama önbelleğinden okunur; erişilemiyorsa boş kalır. Gerçek cihazlarda GPS kaynağı olmadığı için konum alanları boştur. Dummy konumlar örnektir. `FirstSeen` UTC'dir ve aynı node süreci boyunca sabit kalır. Bluetooth için `Frequency` MHz değil, cihaz sınıf kodudur.

Bu değişiklikten sonra server ve tüm node'ları birlikte güncelleyip yeniden başlat; ardından tarayıcıyı yenile. Alan açıklamaları, örnek rapor ve donanım sınırlamaları: [WiGLE data format](docs/wigle.md).

## Arayüzü kullan

Türkçe arayüz dört görünümden oluşur:

| Görünüm | Ne için kullanılır? |
| --- | --- |
| **Genel bakış** | Sabit bina toplamları, yeni kayıtlar, gözlem durumu, kısa kat özeti ve cihaz listesinin ilk satırları. |
| **Cihazlar** | Ad/adres araması, tür/kat/durum filtreleri, tam tekil liste ve bir cihazı gören kaynaklar. |
| **Sensörler** | Pi bağlantıları, her radyonun son başarılı taraması/hataları, büyük bina ve kat ataması. |
| **Analiz** | Pi/radyo başına gözlemler, bant filtresi, sıralama, kaynak sinyal geçmişi, dağılım grafikleri ve JSON/WiGLE CSV kaydetme. |

Genel bakışın Wi-Fi, Bluetooth ve **Yeni · son 10 dk** sayaçları bina genelini anlatır; liste filtresiyle değişmez. Aynı adresi üç Pi görürse cihaz listesinde bir satır, ayrıntıda üç kaynak vardır. Aynı adlı farklı adresler ayrı kalır. Bluetooth BT/BLE aynı adres için tekilleştirilir; Wi-Fi ayrı radyo ailesidir. Sayılar adres bazındadır: kişi, kesin fiziksel cihaz veya bağlı Wi-Fi istemci sayısı değildir.

**Gözlenen kat**, yayını duyan sensörün katıdır. Bir kayıt birden fazla katta görülebilir; kat sayıları örtüşür ve toplanarak bina toplamı bulunmaz. En güçlü RSSI cihazı kesin bir kata yerleştirmez. Sinyal değeri uzaklık veya ölçülmüş bağlantı kalitesi değildir.

Bir kayıt seçildiğinde kaynak Pi'ler, kendi RSSI değerleri ve son görülmeleri sağ panelde açılır. Sinyal grafiği seçilen kaynağın bu tarayıcı oturumundaki son 60 ölçümüdür; farklı Pi okumaları tek çizgiye karıştırılmaz. Teknik WiGLE kaydı isteğe bağlı açılır. Kanal grafiği kanal/bant başına farklı BSSID sayısını gösterir; kanal doluluğunu veya paraziti ölçmez.

Analiz dışa aktarması kaynak gözlemlerini korur. CSV WiGLE v1.6'nın metadata satırı ve 14 sütunuyla kaydedilir; JSON ayrıca Pi, filtre, zaman ve durum bilgisini taşır. Tekil cihaz sayısı ile kaynak gözlemi sayısı farklı olabilir.

### Gözlem durumları ve kısa dönem geçmiş

Sunucu bağlantısı, Pi heartbeat'i ve radyo tazeliği ayrı izlenir. Son başarılı tarama yaşı `max(30 sn, 2 × beklenen çevrim)` sınırına ulaşınca radyo eski sayılır. Hata veya yeni heartbeat eski ölçümü güncel yapmaz. Bilerek kapalı radyo ayrı gösterilir.

- **Görüldü:** en az bir taze ve çalışan kaynakta son taramada var.
- **Az önce görüldü:** taze kaynak son taramada göremedi, ancak son görülmeden en fazla 60 saniye geçti. Kısa kesintilerde sayılmaya devam eder.
- **Artık görülmüyor:** çalışan kaynakların en az iki başarılı taramasında yok ve `max(60 sn, 3 × beklenen çevrim)` geçti.
- **Durum bilinmiyor:** gözlem kaynağı eksik veya görülmeme için yeterli kanıt yok. Pi kesintisi cihazın kapandığı şeklinde yorumlanmaz.

Güncel gözlemi olmayan kat veya radyo **—** gösterir. Taze ve boş ilk tarama **0** olabilir; önceki kayıtlar varsa 60 saniyelik tolerans uygulanır. Bir kattaki bazı kaynaklar kesilirse sayı **kısmi gözlem** olarak işaretlenir.

Her Pi/radyonun ilk başarılı taraması başlangıç kabul edilir. Sonraki taramalarda ilk kez görülen ortak adres **10 dakika yeni** sayılır. Sayfayı yenilemek yeni kayıt dalgası oluşturmaz. Kaynak gözlemleri son görülmelerinden itibaren **15 dakika**, bütün kaynaklar için en fazla **10.000 kayıt** olarak sunucu belleğinde tutulur. Sunucu oturumunda yeniden görülmeyi tanımak için ayrıca en fazla 10.000 kimlik korunur. Kapasite aşılırsa eski kimlikler unutulabilir. Sunucu yeniden başlatıldığında bu geçici geçmiş yeni bir izleme dönemiyle başlar; kalıcı cihaz tarihçesi yoktur.

### Paylaşılan kat yerleşimi

**Sensörler** görünümünde `pi-01`, `pi-02`, `pi-03` varsayılan olarak 1., 2., 3. kattadır; `pi-1` gibi adlar da tanınır. Bir Pi seçip **Bulunduğu kat** menüsünden taşıyabilirsin. Bir katta birden çok Pi bulunabilir. Diğer kimlikler atanmamış başlar; atanmamış sensörün gözlemleri genel listede kalır.

Atamalar `.device-scanner/placements.json` dosyasında sunucu tarafından atomik olarak kaydedilir, diğer tarayıcılarla paylaşılır ve sunucu yeniden başlatıldığında korunur. Açıkça “Yerleştirilmemiş” seçmek varsayılan katı da kaldırır. Dosya yolu `server` veya `dev` komutunda `--placements-file PATH` ile değişir. WiGLE tarama kayıtlarına kat alanı eklenmez.

Kat yerleşimleri artık ortak sunucu dosyasındadır. Önceki sürümün tarayıcıya özel kat seçimleri otomatik aktarılmaz; gerekiyorsa Sensörler ekranında bir kez yeniden seçilir.

HTML/CSS/JavaScript doğrudan Python sunucusundan sunulur. Çalıştırmak için Node.js, npm kurulumu veya derleme gerekmez. Arayüz dosyaları sunucu başlarken okunur; değişiklikten sonra sunucuyu yeniden başlatıp sayfayı yenile. Tasarım kararları: [Birleşik one-shot planı](one-shot-vision-astra.md). Kodun iş bölümü: [Frontend guide](docs/frontend.md).

Bu sürüm geliştirme ve güvenilen yerel ağ içindir; HTTP üzerinde kimlik doğrulama yoktur. DHCP, kalıcı tarama veritabanı ve otomatik servis kurulumu kapsam dışıdır.

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

Tarayıcı kontrolü kurulu Chrome kullanır; gerekirse `CHROME_BIN=/path/to/chromium` ve `PYTHON=/path/to/python` belirt. Geçici sunucular ve sentetik raporlar oluşturur, test sonunda kapatır. Üç masaüstü boyutunda ilk ekranı kontrol eder; genel bakış, koyu tema, ayrıntı, sensörler ve analiz görüntülerini `/tmp/device-scanner-oneshot-{overview,dark,drawer,sensors,analysis}.png` konumuna kaydeder.
