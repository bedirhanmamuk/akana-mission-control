# AKANA yer istasyonu — Open MCT prototipi

Open MCT 4.3.1 (NASA, Apache 2.0) üzerine kurulu AKANA eklentisi. Şu an **simülasyon modunda**; veriler dahili simülatörden gelir.

```bash
npm run kur      # openmct paketini indirir, dist/ klasörünü ./openmct altına kopyalar
npm run baslat   # http://localhost:8765 adresini tarayıcıda aç
```

- `index.html` + `akana-sky.js` — sade görev ekranı (SkyView düzeni). Uçuş profili gömülü Open MCT grafiğidir;
  "Çalışma alanı" tuşu tam Open MCT arayüzünü (ağaç, LAD/tablo, düzenler, defter) açar. Açık/koyu tema.
- `akana-analiz.js` — Analiz modu (PlotJuggler çalışma biçiminden esinlenildi, kod alınmadı): sinyal ağacından sürükle-bırak,
  1/2/4 bölmeli grafik alanı, ortak zaman imleci ve X ekseni, XY grafiği, türetilmiş sinyaller (türev, integral,
  hareketli ortalama/std, ölçek, mutlak, örnekler arası süre, aykırı değer temizleme), olay işaretleri, kayıt oynatma (0,5–10×).
- `calisma-alani.html` — yalnızca Open MCT arayüzü (önceki sürüm).
- `akana.js` — simülasyon çekirdeği (uçuş modeli, doğrulama, olay teyidi, şartname kontrolleri) + Open MCT eklentisi
  (nesne sağlayıcı, telemetri sağlayıcı, 6 özel görünüm, esnek düzen "Operasyon ekranı", hakem ekranı).
- `tiles.js` — Aksaray rampa çevresi çevrimdışı harita karoları (© Esri).
- Gerçek sisteme geçişte yalnızca telemetri sağlayıcısının `request/subscribe` kaynağı değişir
  (simülatör yerine yi-core WebSocket akışı); görünümler aynı kalır.
