# Sunucu Kurulumu

Bu klasor, uygulamayi kendi sunucunda domain altinda yayinlamak icin hazirlanmis minimal pakettir.

## 1. Ortam dosyasi

```bash
cp .env.example .env
```

`.env` icinde sunlari doldur:

- `APP_SECRET_KEY`
- `SERVER_NAME`

## 2. SSL sertifikasi

Sertifika dosyalarini bu klasore koy:

- `deploy/certs/fullchain.pem`
- `deploy/certs/privkey.pem`

## 3. Ilk kullaniciyi olustur

```bash
python scripts/create_user.py --username admin --password 'guclu-bir-sifre' --admin
```

## 4. Yayina al

```bash
docker compose up -d --build
```

## 5. Giris

Uygulama acildiktan sonra olusturdugun kullanici ile domain uzerinden giris yapabilirsin.

## Notlar

- `data/` klasoru otomatik olusur ve kalici kullanici verilerini tutar.
- Bu paket kullanici verisini veya eski local `storage.txt` / `link.txt` dosyalarini icermez.
- Eger legacy veriyi de tasimak istersen o iki dosyayi bu klasore elle ekleyip kullanici olustururken `--migrate-legacy` kullanabilirsin.
