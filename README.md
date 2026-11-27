# Carte+ — carte fedeltà sempre in tasca

Web-app per salvare le carte fedeltà sul telefono e mostrarle alla cassa.
**Funziona completamente offline**: dopo la prima apertura tutto (app, lettore di codici, carte) resta sul telefono.

## Cosa fa
- **Aggiungi carta** in tre modi: inquadrando il codice a barre con la fotocamera, da una foto già scattata, oppure scrivendo il numero a mano.
- **Mostra la carta**: un tocco sulla carta apre il codice a barre grande su sfondo bianco, con il numero sotto; lo schermo resta acceso finché è aperta.
- Codici supportati: EAN-13, EAN-8, UPC-A/E, Code 128, Code 39, Code 93, ITF, Codabar, QR Code.
- Colore, foto e note facoltative per ogni carta; ricerca quando le carte sono tante.
- **Copia di sicurezza**: esporta/importa un file `.json` (da Impostazioni) per non perdere le carte cambiando telefono.
- Nessun server, nessun account: i dati restano solo sul dispositivo (IndexedDB).

## Pubblicazione (una volta sola)
L'app è un sito statico: serve solo un indirizzo **https** (necessario per fotocamera e modalità offline).

Con GitHub Pages:
1. Unisci questo branch in `main`.
2. Su GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Il workflow `.github/workflows/pages.yml` pubblica l'app su `https://<utente>.github.io/carte-plus/`.

> Su un repository privato GitHub Pages richiede un piano a pagamento; in alternativa vanno bene Netlify, Cloudflare Pages o Vercel (basta caricare la cartella così com'è).

## Installazione sul telefono
- **iPhone (Safari)**: Condividi → *Aggiungi alla schermata Home*.
- **Android (Chrome)**: menu ⋮ → *Installa app* (oppure il pulsante in Impostazioni dentro l'app).

Aprire l'app una volta con internet: da quel momento funziona anche in modalità aereo.

## Sviluppo
Nessuna compilazione. Per provarla in locale:
```bash
python3 -m http.server 8000
```
e aprire `http://localhost:8000`.

Quando si modificano i file, aumentare `CACHE` in `sw.js` (e `APP_VERSION` in `app.js`) così i telefoni scaricano la nuova versione.

Librerie incluse in `vendor/` (nessun CDN, per l'uso offline): JsBarcode (MIT), qrcode-generator (MIT), ZXing (Apache-2.0).
