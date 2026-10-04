# One-shot vision: Binadaki kablosuz cihazlar tek bakışta

*Hazırlanma: 2026-10-04 · İncelenen sürüm: `4a7daa6` (three-floor building view)*

**Kararlar (2026-10-04):**
- Pano **masaüstünde** kullanılacak. Ayrı bir mobil tasarım yapılmayacak.
- Konum **kat düzeyinde** kalacak. Oda veya bölge kavramı eklenmeyecek.

## Özet

- **Ana ekranın konusu cihazlar olmalı.** Bugün öne çıkan konu ise Pi'ler. Pi'ler sensördür; yalnız verinin güvenilirliğini etkilediklerinde öne çıkmalılar.
- **İlk ekran beş saniyede dört soruyu cevaplamalı:**
  1. Binada şu an kaç kablosuz cihaz var?
  2. Hangi katta?
  3. Veri güncel ve eksiksiz mi?
  4. Dikkat edilecek bir şey var mı?
- **Bina görünümü kalsın, içeriği değişsin.** Katlarda Pi kartları yerine o kattaki tahmini cihaz sayısı ve yoğunluğu gösterilsin. Görsel aynı kalır ama doğru soruyu cevaplar.
- **İkincil işler ana ekrandan çıksın.** Pi'yi kata atama "Sensörler" sekmesine; sinyal grafikleri, kanal kullanımı, ham WiGLE alanları ve dışa aktarma "Analiz" sekmesine taşınsın.

---

## 1. Mevcut durum

Bu bölüm 3 dummy node ile `dev` modunda, 1440×900 masaüstü ve 390×844 mobil ekran görüntülerine ve koda dayanıyor.

### Yerleşim sorunları

| Gözlem | Neden sorun |
|---|---|
| İlk ekranın büyük kısmı Pi'lere ayrılmış: sol menüde Pi listesi, ortada ~525 px yüksekliğinde bina içinde Pi kartları, metriklerde "Scanners online". | Kullanıcı açılışta "binada ne var?" sorusunun cevabını değil, altyapıyı görüyor. |
| Cihaz listesi yaklaşık 970. pikselden sonra başlıyor. İlk ekranda cihazlar yalnızca iki metrik kartında sayı olarak geçiyor. Telefonda ilk ekran tamamen Pi listesi ve bina. | Asıl bilgi ekranın altında kalıyor. |
| Aynı Pi bilgisi beş yerde tekrar ediyor: sol menü, bina kartı, seçili Pi paneli, "Scanners online" metriği, tablodaki SCANNER sütunu. | Görsel ağırlık yanlış öğeye gidiyor; ekran kalabalıklaşıyor. |
| Sağdaki "SEÇİLİ PI / Bir Pi seçin" paneli, ilk ekranın en değerli yerinde ~250×430 px'lik boş bir alan. Burada yapılan iş (Pi'yi kata atamak) bir kurulum işi. | İzleme ekranında yönetim işi yer kaplıyor. |
| Kat alanları dekoratif bir ızgara. Pi kartındaki "Wi-Fi 1 · BT 1" o katta ne olduğunu değil, Pi'nin ne duyduğunu söylüyor. | Bina metaforu var ama cihaz bilgisini taşımıyor. |
| En belirgin buton (dolu teal) **Export**. **Refresh** de vurgulu, oysa sayfa zaten iki saniyede bir yenileniyor. | Bu ekranda en önemli eylem dışa aktarma değil. |

### Sayılar ve anlam sorunları

| Gözlem | Neden sorun |
|---|---|
| Sayılar cihaz değil "gözlem" sayıyor (her Pi × cihaz bir satır). Aynı erişim noktasını 3 Pi duyarsa 3 kez sayılıyor. Bina genelinde tekil cihaz sayısı yok. | "Kaç cihaz var?" sorusunun doğru cevabı ekranda hiç yok. |
| Metrikler seçili radyo sekmesine ve seçili Pi'ye göre değişiyor ("Wi-Fi observations" ↔ "Bluetooth observations"). | Aynı kart farklı anlarda farklı şeyler söylüyor; tek bakışta okunamıyor. |
| "Strongest signal −63.2 dBm" ve "Scan errors" ana metrik olarak duruyor. | İlki binayı izleyen biri için anlamsız. İkincisi bir altyapı bilgisi ve tek başına bir sayı. |

### Dil ve sunum sorunları

| Gözlem | Neden sorun |
|---|---|
| Dil karışık: "Wireless overview", "Scanners online", "Nearby access points" ile "Bina yerleşimi", "Çevrimiçi", "Bir Pi seçin" aynı ekranda. | Tutarsız ve yorucu. |
| Teknik dil ön planda: ondalıklı dBm değerleri, `[WPA2-PSK-CCMP][ESS]`, `Misc [BLE]`, "Sample latitude / Altitude / Accuracy". Bu konum alanları gerçek Pi'de boş. | Uzman olmayan biri için gürültü. |
| "Signal over time" ve "Channel usage" grafikleri genel bakış sayfasında. | Bunlar analiz araçları; tek bakışlık özetin parçası değil. |

### Mantık sorunları

| Gözlem | Neden sorun |
|---|---|
| Kat ataması tarayıcının `localStorage` alanında tutuluyor (`device-scanner-placement-v1`). | İki kişi aynı binayı farklı katlarla görebilir. Ortak bir bina görünümü için güvenilmez. |
| Dummy veride her Pi tam 1 Bluetooth ve 1 Wi-Fi cihazı üretiyor. | Tasarım gerçekçi bir yükle denenemiyor: binlerce satırda, örtüşen cihazlarda ve kaybolan cihazlarda ekranın nasıl davrandığı görülmüyor. |

**Korunması gereken güçlü yanlar:**
- Temiz görsel dil, açık/koyu tema.
- Yerinde güncelleme: seçim, kaydırma ve odak yenilemede korunuyor.
- Satır sırası yenilemelerde sabit kalıyor.
- Klavye erişimi ve ARIA etiketleri.
- "Eski veri" ve "bağlantı yok" durumları dürüstçe gösteriliyor.
- "Wi-Fi bağlı istemcileri değil erişim noktalarını gösterir" notu var.

---

## 2. Ekranın görevi ve kullanıcısı

**Birincil kullanıcı (varsayım):** binayı izleyen kişi, yani tesis, IT veya güvenlik sorumlusu. Sorusu şu: *"Binada şu an hangi kablosuz cihazlar var, nerede ve durum normal mi?"*

**İkincil kullanıcı:** teknik kişi. Sensör kurulumu, sinyal ve kanal analizi ve veri dışa aktarma ile ilgilenir.

**Kullanım ortamı:** masaüstü tarayıcı, fare ve klavye.
- Hedef ekranlar 1366×768 dizüstünden 1920×1080 monitöre kadar uzanıyor.
- En dar durum, 1366×768 dizüstünde tarayıcı çubukları çıktıktan sonra kalan yaklaşık 1366×650'lik alan. "Tek bakış" bu alanda da sağlanmalı.
- Telefon hedef değil; dar pencerede sayfanın bozulmaması yeterli.

Sonuç olarak iki katman olmalı:
- **Genel bakış** (varsayılan): birincil kullanıcı için, tek bakışta.
- **Cihazlar / Sensörler / Analiz:** ayrıntı ve teknik iş için. Mevcut tablo, grafikler ve dışa aktarma burada yaşamaya devam eder; kaybolan özellik olmaz.

---

## 3. Bilgi hiyerarşisi (yukarıdan aşağıya)

| Sıra | Ne | Hangi soruyu cevaplar | Bugün nerede |
|---|---|---|---|
| 1 | **Durum cümlesi:** tek satır, en üstte | Durum normal mi, dikkat gereken bir şey var mı? | Yok |
| 2 | **Özet sayılar:** Bluetooth cihazı, Wi-Fi erişim noktası, yeni, kapsama | Kaç cihaz var? | Kısmen var: gözlem sayısı, sekmeye bağlı |
| 3 | **Katlara göre dağılım:** bina görünümü | Nerede? | Bina var ama Pi gösteriyor |
| 4 | **Cihaz listesi:** tekil, sade dille | Hangi cihazlar? | Ekranın altında, Pi başına satır |
| 5 | **Cihaz ayrıntısı** | Bu cihaz ne, kim duyuyor? | Var, teknik alan ağırlıklı |
| 6 | **Sensörler (Pi'ler):** sorun yoksa sessiz, sorun varsa üstte uyarı | Veriye güvenebilir miyim? | En üstte ve beş yerde |
| 7 | **Analiz:** sinyal geçmişi, kanal kullanımı, dışa aktarma | Teknik inceleme | Genel bakışın içinde |

**Kural:** sensör bilgisi kendi başına bir içerik değildir; "veri güvenilir mi?" sorusunun cevabıdır. Sorun yoksa tek bir küçük gösterge yeter ("3/3 sensör çalışıyor"). Sorun varsa en üstte, etkisini anlatan bir cümle çıkar.

---

## 4. Önerilen yerleşim

### 4.1 Masaüstü, ilk ekran (1440×900)

Sol koyu menü kaldırılıyor; şu an yalnız Pi gezinmesi için ~236 px genişlik kaplıyor. Gezinme üst çubuktaki sekmelere taşınıyor.

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ ◉ Device Scanner   [Genel bakış] Cihazlar  Sensörler  Analiz   ● Canlı · 3 sn │
├──────────────────────────────────────────────────────────────────────────┤
│ ✓ Binada şu an 19 Bluetooth cihazı ve 8 Wi-Fi erişim noktası görülüyor.  │
│   En yoğun kat: 2. kat. 3 sensörün 3'ü çalışıyor.                        │
├─────────────────┬─────────────────┬─────────────────┬────────────────────┤
│ BLUETOOTH       │ WI-FI           │ YENİ · son 10 dk │ KAPSAMA            │
│ 19 cihaz        │ 8 erişim noktası│ 3               │ 3/3 sensör         │
│ 11 telefon ·    │ 4 ağ ·          │ 2 BT · 1 Wi-Fi  │ BT ✓  Wi-Fi ✓      │
│ 4 kulaklık …    │ 1 şifresiz ⚠    │                 │                    │
├─────────────────┴──────────┬──────┴─────────────────┴────────────────────┤
│ KATLARA GÖRE (tahmini)     │ CİHAZLAR  [Tümü 27] [Bluetooth 19] [Wi-Fi 8] │
│                            │           [Yeni 3]        ⌕ Ara…           │
│ 3. kat  ███░░░░░░   5   ●  │ ᛒ Ahmet'in iPhone  Telefon   ▮▮▮▮ Güçlü  2. kat · şimdi │
│ 2. kat  █████████  12   ●  │ ≋ Ofis-5G          Wi-Fi AP  ▮▮▮▯ İyi    1. kat · şimdi │
│ 1. kat  ███████░░  10   ●  │ ᛒ JBL Flip 5       Hoparlör  ▮▮▯▯ Orta   2. kat · 12 sn │
│ ─────── GİRİŞ ───────      │ ᛒ Apple cihazı     Bilinmiyor ▮▯▯▯ Zayıf 3. kat · YENİ  │
│ ■ Bluetooth  ■ Wi-Fi       │ … 23 cihaz daha  ›                          │
└────────────────────────────┴─────────────────────────────────────────────┘
```

- **Kat satırı:** Bluetooth ve Wi-Fi yığılmış çubuk, sayı ve o kattaki sensörlerin küçük durum noktası (●).
- **Kata tıklamak** listeyi o kata göre filtreler; tekrar tıklamak filtreyi kaldırır.
- **Listedeki bir satır** sağdan açılan bir ayrıntı panelini açar.

### 4.2 Sorunlu durum (kısmi kapsama)

```text
│ ⚠ 2. kat sensörü (pi-02) 2 dk'dır veri göndermiyor.                      │
│   2. kat sayıları eksik olabilir.                     [Sensörleri gör ›]  │
...
│ 2. kat  ░░ veri yok ░░   —   ○  │
```

- **"0" ile "veri yok" asla karıştırılmamalı.** Sensörü olmayan veya sensörü yanıt vermeyen kat "—" ve tarama deseniyle gösterilir.
- **Uyarı etkiyi söyler:** "pi-02 offline" değil, "2. kat sayıları eksik olabilir".

### 4.3 Masaüstü genişlikleri

| Pencere genişliği | Düzen |
|---|---|
| ≥ 1600 px (geniş monitör) | Üç sütun: katlar · cihaz listesi · seçili cihazın ayrıntısı sağda sabit. |
| 1280–1599 px (dizüstü) | İki sütun: katlar · cihaz listesi. Ayrıntı sağdan açılan bir panelde. |
| 1024–1279 px (küçük dizüstü, bölünmüş pencere) | İki sütun; kat sütunu daralır ve yalnız çubuk ile sayıyı gösterir. |
| < 1024 px | Bölümler alt alta. Ayrı bir mobil tasarım yok; amaç yalnız bozulmaması. |

**Yükseklik bütçesi:** 1366×650'de durum cümlesi, özet kartları, üç kat satırı ve cihaz listesinin ilk satırları kaydırmadan görünmeli. Kabaca: üst çubuk ~56 px, durum ~64 px, kartlar ~110 px, katlar ~200 px. Geriye listenin ilk 4–5 satırı için yer kalır.

**Masaüstü etkileşimleri:**
- Fareyle üzerine gelince ipucu gösterilebilir (örneğin dBm değeri). Aynı bilgi klavyeyle odaklanınca da görünmeli.
- Klavye kısayolları:
  - `/` aramaya gider (bugün de var).
  - `1` `2` `3` ilgili katı filtreler.
  - `Esc` filtreyi ve açık paneli kapatır.
- Listede ok tuşlarıyla gezinme bugün de var; korunuyor.

### 4.4 Diğer sekmeler

- **Cihazlar:** tam liste, tüm filtreler ve ayrıntı paneli.
- **Sensörler:**
  - Pi tablosu: kat, durum, her radyonun son raporu ve hata metni, demo/gerçek ayrımı.
  - **Kat atama burada.** Bugünkü "Bulunduğu kat" seçimi ve "Yerleştirilmemiş Pi'ler" alanı bu sekmeye taşınır.
- **Analiz:** bugünkü gözlem tablosu (Pi başına satır), sinyal geçmişi, kanal kullanımı ve JSON/CSV dışa aktarma. Teknik kullanıcının bugün sahip olduğu her şey burada korunur.

---

## 5. Bileşen kuralları

### 5.1 Durum cümlesi

Bir cümleyle "her şey yolunda mı?" sorusunu cevaplar. Durumlar öncelik sırasıyla:

| Durum | Örnek metin | Renk |
|---|---|---|
| Sunucuya ulaşılamıyor | "Sunucuya ulaşılamıyor. Son veriler 14:02'den; yeniden deneniyor." | Kırmızı |
| Sensör yanıt vermiyor | "2. kat sensörü 2 dk'dır veri göndermiyor. 2. kat sayıları eksik olabilir." | Amber |
| Radyo hatası | "pi-03 Bluetooth taraması başarısız: …. 3. kat Bluetooth verisi eksik." | Amber |
| İlk veri bekleniyor | "Sensörlerden ilk tarama bekleniyor…" | Nötr |
| Normal | "Binada şu an 19 Bluetooth cihazı ve 8 Wi-Fi erişim noktası görülüyor. En yoğun kat: 2. kat." | Yeşil ✓ |
| Normal, cihaz yok | "Tüm sensörler çalışıyor; şu an kablosuz cihaz görülmüyor." | Yeşil ✓ |

- **Demo modu:** sensörlerden biri bile `dummy` ise en üstte kalıcı bir şerit çıkar: "Demo verisi: Bu sayılar gerçek tarama değildir."
- **Ekran okuyucu:** `aria-live="polite"` yalnız durum *türü* değiştiğinde duyurulur. İki saniyede bir değişen sayılar okunmaz.

### 5.2 Özet sayılar

- **Tekil cihaz sayılır, gözlem değil.** Anahtar `Type + MAC` (büyük harfe çevrilmiş). Aynı cihazı üç sensör duyarsa bir kez sayılır.
- **Anlamları sabittir.** Sekme, arama veya seçili kat bu kartları değiştirmez; filtreler yalnız listeyi etkiler. Bugünkü metrikler seçili radyo sekmesine göre değişiyor; bu kalkmalı.
- **Kartlar:**
  - *Bluetooth:* sayı ve en sık 2–3 tür.
  - *Wi-Fi:* erişim noktası sayısı, ağ (SSID) sayısı ve varsa "şifresiz ağ" uyarısı.
  - *Yeni:* son 10 dk'da ilk kez görülenler.
  - *Kapsama:* çalışan sensör sayısı ve radyoların durumu.
- **Kaldırılacaklar:** "Strongest signal" (Analiz'e) ve "Scan errors" (durum cümlesine ve Sensörler'e).
- **"Yeni" için uyarı:** mevcut `FirstSeen` her node sürecinde ayrı tutuluyor ve node yeniden başlayınca sıfırlanıyor. Bina düzeyinde güvenilir değil. Faz 1'de "sayfa açıldığından beri" olarak etiketlenir; Faz 2'de sunucu tarafında doğru hesaplanır (bkz. §7).

### 5.3 Katlara göre dağılım (bina görünümü)

- **Hangi kata yazılır:** bir cihaz, onu **en güçlü sinyalle duyan sensörün katına** yazılır.
  - Etiket her zaman "tahmini" olur; RSSI uzaklık ölçümü değildir.
  - Sinyal bilinmiyorsa ya da eşitlik varsa cihaz "Belirsiz" grubuna gider.
- **Konum çözünürlüğü kat ile sınırlı (karar).** Bir katta birden fazla sensör olabilir. Kat sayısı, en güçlü sinyali o kattaki sensörlerden birine gelen cihazların toplamıdır.
- **Kısmi kapsama:** bir kattaki sensörlerden yalnız bazıları yanıt vermiyorsa, o kat "kısmi" olarak işaretlenir. Örnek: "2. kat: 2 sensörden 1'i yanıt vermiyor; sayı eksik olabilir."
- **Kat satırı:** Bluetooth ve Wi-Fi yığılmış çubuk ile sayı gösterir. Ayrıca o katın sensör noktası olur:
  - ● çalışıyor,
  - ○ yanıt vermiyor,
  - ⚠ radyo hatası.
- **Pi kartları kat içinde gösterilmez.** Sensör yalnız küçük nokta olarak görünür; kimliği (pi-02) ipucu metninde (tooltip) yer alır.
- **Kat yerleşimi sunucuda tutulmalı.** Faz 2'de node bunu bildirir; Faz 1'de mevcut `placement.js` mantığı Sensörler sekmesine taşınarak kullanılabilir. Böylece herkes aynı binayı görür.

### 5.4 Cihaz listesi

| Sütun | İçerik | Kaynak |
|---|---|---|
| Tür ikonu | Bluetooth / Wi-Fi | `Type` |
| Ad | Yayınlanan ad. Yoksa "‹Üretici› cihazı", o da yoksa "Adsız cihaz". Wi-Fi'de boş SSID için "Gizli ağ". | `SSID`, `MfgrId` |
| Tür | Telefon, Kulaklık, Hoparlör, Bilgisayar, Klavye/Fare, Saat, Bilinmiyor, Wi-Fi erişim noktası | Bluetooth `AuthMode` öneki: BlueZ `Icon` (`phone`, `audio-headset` …) |
| Sinyal | 4 çubuk + "Güçlü / İyi / Orta / Zayıf". dBm yalnız ipucunda. | `RSSI` |
| Kat | Tahmini kat | En güçlü sensör |
| Son görülme | "şimdi", "40 sn önce" | Rapor zamanı |
| Etiket | YENİ, ŞİFRESİZ, ESKİ VERİ | Türetilmiş |

- **Sinyal eşikleri** (öneri): ≥ −60 dBm Güçlü, −60…−70 İyi, −70…−80 Orta, < −80 Zayıf. Uzaklık dili ("yakın/uzak") kullanılmaz; belgelerdeki "dBm uzaklık değildir" ilkesiyle tutarlı kalır.
- **Kararlı sıralama:** mevcut "satır sırası korunur, yeni satırlar sona eklenir" mekanizması aynen kalır. Varsayılan sıra kat, sonra ad. Sinyal değişince satırlar zıplamaz.
- **Kısa süreli kaybolmalar:**
  - Son taramada görünmeyen cihaz 60 sn boyunca soluk, "az önce görüldü" olarak kalır, sonra listeden çıkar.
  - BLE cihazları aralıklı yayın yapar; bu tolerans olmadan sayılar her taramada oynar ve tek bakışta güveni bozar.
- **Çok cihaz:** ilk 50 satır gösterilir, ardından "Tümünü göster (312)".
- **Teknik alanlar ayrıntıya:** MAC, ham `AuthMode`, kanal ve frekans listede değil ayrıntıda yer alır.

**Üretici eşlemesi:** küçük bir tablo yeter. Örnek: 76 → Apple, 6 → Microsoft, 117 → Samsung, 224 → Google. Böylece "Adsız cihaz" yerine "Apple cihazı" yazılır.

### 5.5 Cihaz ayrıntısı (yan panel)

1. **İnsan diliyle özet:** ad, tür, üretici, tahmini kat, ilk/son görülme.
2. **"Kim duyuyor":** her sensör için kat, sinyal çubuğu ve dBm. Konum tahmininin neden o kat olduğunu açıklar.
3. **Sinyal geçmişi:** mevcut `charts.js` grafiği buraya, seçili cihaz bağlamına taşınır.
4. **"Teknik ayrıntılar"** (kapalı başlar): MAC, kanal/bant, ham güvenlik, `Frequency`/cihaz sınıfı ve WiGLE kaydı.
   - Boş konum alanları gizlenir.
   - Dummy'de konum alanları "örnek veri" etiketiyle gösterilir.

### 5.6 Sensörler sekmesi

- **Tablo sütunları:** Sensör (pi-01) · Kat · Durum · Bluetooth (✓ 3 sn önce veya hata metni) · Wi-Fi · Son iletişim · Kaynak (Demo/Gerçek).
- **Kat atama** bu sekmede yapılır.
- **Hata metinleri** burada tam olarak görünür; durum cümlesinde kısaltılmış hali yer alır.

---

## 6. Dil ve terimler

**Tek dil: Türkçe.** README ve bina bölümü zaten Türkçe; bugün ekranda iki dil karışık.

| Bugün | Öneri | Not |
|---|---|---|
| Node, Pi, Scanner, Raspberry Pi nodes | **Sensör** (kimlik küçük yazıyla: pi-01) | "Tarayıcı" kelimesinden kaçının: Türkçede web tarayıcısı anlamına da gelir ve README'de iki anlamda kullanılıyor. |
| Observation, gözlem | **Cihaz** | "Gözlem" yalnız Analiz sekmesinde kalır. |
| Access point, network | **Wi-Fi erişim noktası** / **ağ** (SSID) | Wi-Fi'nin istemci değil erişim noktası gösterdiği notu korunur. |
| Online / Offline | **Çalışıyor** / **Yanıt vermiyor** | |
| Latest / Previous / Outdated | **Güncel** / **Eski veri** | |
| Dummy | **Demo verisi** | |
| Strongest signal, dBm | **Sinyal: Güçlü/İyi/Orta/Zayıf** | dBm ipucunda ve Analiz'de kalır. |
| "Discover what's nearby…", "One view of the wireless world…" | Kaldır | Tanıtım metni; bilgi taşımıyor. |

---

## 7. Veri ve backend gereksinimleri

### Faz 1: yalnız frontend (mevcut `/api/nodes` ile)

- `observations.js` dosyasına saf fonksiyonlar eklenir:
  - `devices(nodes, placements)`: `Type + MAC` ile gruplar, sensör başına okumaları saklar, en güçlü sensörden katı bulur.
  - `deviceKind(record)`, `vendorName(id)`, `signalLevel(dbm)`.
  - Hepsi `tests/frontend` altında birim testlenir.
- "Şu an" sayılarına yalnız `state === "latest"` satırları girer. Çevrimdışı veya hatalı sensörlerin eski verileri "eski veri" etiketiyle ayrı tutulur. Bu ayrım bugün de var.
- 60 sn tolerans ve "yeni" bilgisi tarayıcı oturumunda tutulur. Bu sınırlama ekranda açıkça yazar.
- **Dummy senaryosu zenginleştirilir** (`scanners/dummy.py`). Tasarımı gerçekçi yükte denemek için şart:
  - Kat başına 5–40 cihaz.
  - Komşu katlardaki sensörlerin aynı cihazı farklı sinyalle duyması.
  - Ara sıra kaybolan ve yeni gelen cihazlar.
  - Bir şifresiz ağ ve bir gizli ağ.
  - Farklı Bluetooth türleri (telefon, kulaklık, saat…).

### Faz 2: sunucu

- **Sensör konumu sunucuda:**
  - Node, heartbeat içinde yalnız katını bildirir: `node --floor 2`. Konum kat düzeyinde kaldığı için serbest metinli bir yer etiketine gerek yok.
  - Sunucu bunu `/api/nodes` yanıtına koyar.
  - Tarayıcıdaki `localStorage` ataması kalkar, en fazla geçici bir yedek olarak kalır.
- **`GET /api/devices`:**
  - Bina düzeyinde tekil cihazlar.
  - Node yeniden başlasa da korunan `first_seen` ve `last_seen` (bugünkü `FirstSeen` node yeniden başlayınca sıfırlanıyor).
  - Tolerans penceresi ve `new` bayrağı.
  - Hesap sunucuda yapılır; birden çok ekran aynı sonucu görür.
- **Radyo başına yaş ve kapalı radyolar** (`dev-notes.md` #2). "Kapsama" kartı ancak bununla dürüst olur. Bugün kapalı bir radyo sonsuza kadar "bekleniyor" görünüyor.
- **BLE adres türü** (random/public). WiGLE kaydının dışında bir ek alan olarak gönderilir. Adres değiştiren telefonları "anonim" diye ayrı göstermek ve fazla saymamak için gerekli.

### Faz 3: sonra

- Geçmiş ve eğilim grafikleri (kalıcı depolama gerekir).
- Bildirimler: yeni bilinmeyen cihaz, şifresiz ağ, sensör düştü.
- Bilinen cihazlara isim verme ("Toplantı odası hoparlörü").

**Kapsam dışı (kararlar gereği):** oda veya bölge düzeyinde konum, mobil tasarım ve duvar ekranı (kiosk) modu.

---

## 8. Faz 1 iş listesi (dosya bazında)

| Dosya | Değişiklik |
|---|---|
| `static/index.html` | Sol menüyü kaldır. Üst çubuğa sekmeler: Genel bakış / Cihazlar / Sensörler / Analiz. Durum cümlesi, sabit anlamlı 4 kart ve iki sütun (katlar \| cihazlar) ekle. Kat atama panelini Sensörler'e, tablo + grafikler + Export'u Analiz'e taşı. |
| `static/styles.css` | Menüsüz ızgara, amber renk tokenı (bugün yalnız yeşil, kırmızı ve teal var), kat yoğunluk çubukları, cihaz satırı, masaüstü kırılım noktaları (1600 / 1280 / 1024 px). |
| `js/observations.js` | `devices`, `deviceKind`, `vendorName`, `signalLevel`. |
| `js/building.js` | Kat içeriği: Pi kartı yerine cihaz sayısı, yığılmış çubuk ve sensör noktası; kata tıklayınca filtre. "0" ile "veri yok" ayrımı. |
| yeni `js/overview.js` | Durum cümlesi ve özet kartları. |
| yeni `js/devices.js` | Tekil cihaz listesi ve ayrıntı paneli (`details.js` buraya evrilir). |
| `js/nodes.js` | Sol menü listesi yerine Sensörler tablosu. |
| `js/app.js` | Görünüm durumuna `tab` ve `floor` eklenir. Metrikler sekmeden bağımsız hale gelir. |
| `scanners/dummy.py` | Zengin demo senaryosu (§7). |
| `tests/frontend/*`, `tools/check_browser.mjs` | Tekilleştirme ve kat atama testleri. Yeni seçiciler ve ekran görüntüleri. İlk ekran ölçümü (§9). |
| `docs/frontend.md`, `README.md` | Yeni yapı ve terimler. |

Mevcut `results.js`, `charts.js` ve `export.js` büyük ölçüde olduğu gibi Analiz sekmesine taşınır. Teknik işlev kaybolmaz.

---

## 9. Başarı ölçütleri

1. **5 saniye testi:** ekranı 3–5 kişiye beş saniye gösterip kapatın ve dört soruyu sorun:
   - Kaç Bluetooth cihazı ve Wi-Fi ağı var?
   - En yoğun kat hangisi?
   - Bütün sensörler çalışıyor mu?
   - Dikkat gereken bir şey var mı?

   Hedef: en az 4/5 kişi dört soruyu da doğru cevaplasın.
2. **İlk ekran kontrolü** (otomatik, `check_browser.mjs`): 1366×650, 1440×900 ve 1920×1080'de şunlar kaydırmadan görünmeli (`getBoundingClientRect().bottom <= innerHeight`):
   - durum cümlesi,
   - özet kartları,
   - kat dağılımı,
   - cihaz listesinin ilk satırları.
3. **Tekrar yok:** Pi kimliği Genel bakış'ın ilk ekranında yalnız sorun olduğunda görünür.
4. **"0" ile "veri yok" ayrımı:** yanıt vermeyen sensörün katı hiçbir yerde "0 cihaz" olarak gösterilmez. Bu durum testle doğrulanır.
5. **Kararlılık:** iki saniyelik yenilemelerde satır sırası değişmez. Kısa süreli kaybolmalar sayıları oynatmaz: dummy fade senaryosunda toplam sayı sabit kalmalı.

---

## 10. Kararlar ve açık sorular

**Cevaplananlar:**
- **Kullanım ortamı:** masaüstü. Bu karar §2, §4.3 ve §9'a işlendi.
- **Konum hassasiyeti:** kat düzeyi. Bu karar §5.3 ve §7'ye işlendi.

**Açık kalanlar:**
1. **Bir katta birden fazla sensör olacak mı?** Cevap "kısmi kapsama" durumunun ne kadar önemli olduğunu belirler (§5.3).
2. **Wi-Fi'nin yeri:** erişim noktaları bina altyapısı, Bluetooth cihazları ise çoğunlukla insanların cihazları. İkisi ayrı mı sunulmalı? Öneri: ayrı sayılar, karışık bir "toplam" yok.
3. **"Yeni cihaz" ne zaman önemli?** Bilinen cihaz listesi gerekiyor mu?
4. **Adres değiştiren BLE cihazları** sayılmalı mı, "anonim" olarak ayrı mı gösterilmeli?
5. **Arayüz tamamen Türkçe mi olmalı?** Yoksa iki dil desteği mi gerekecek?
