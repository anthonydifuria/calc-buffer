/* ============================================================
   Calcolatrice Buffer Audio — motore di calcolo
   Copre 13 formati audio, con breakdown byte-per-byte dove il
   formato è deterministico (contenitori PCM) e stime dichiarate
   dove la dimensione dipende dal contenuto/encoder (compressi).
   Ogni componente mostra: la moltiplicazione/addizione con i
   numeri veri, una spiegazione tecnica e una metaforica.
   ============================================================ */

(function () {
  "use strict";

  /* ---------- utility numeriche ---------- */

  function fmtN(n, maxDec) {
    if (n === null || n === undefined || !isFinite(n)) return "—";
    var dec = maxDec === undefined ? adaptiveDec(Math.abs(n)) : maxDec;
    return n.toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: dec });
  }
  function adaptiveDec(abs) {
    if (abs === 0) return 0;
    if (abs >= 100) return 1;
    if (abs >= 1) return 2;
    if (abs >= 0.01) return 4;
    return 6;
  }
  function getBase() {
    return document.getElementById("unit-1000").getAttribute("aria-pressed") === "true" ? 1000 : 1024;
  }
  function unitLabels(base) {
    return base === 1000
      ? { k: "kB", m: "MB", g: "GB", t: "TB" }
      : { k: "KiB", m: "MiB", g: "GiB", t: "TiB" };
  }
  function sizeCols(bytes) {
    var b = getBase();
    return {
      bit: bytes * 8,
      byte: bytes,
      k: bytes / b,
      m: bytes / (b * b),
      g: bytes / (b * b * b),
      t: bytes / (b * b * b * b),
      labels: unitLabels(b),
    };
  }

  /* ---------- parametri comuni ---------- */

  function getCommon() {
    var durationRaw = parseFloat(document.getElementById("duration").value) || 0;
    var durationUnit = getPressedMode("duration-unit"); // 's' | 'ms'
    var durationSec = Math.max(0, durationUnit === "ms" ? durationRaw / 1000 : durationRaw);

    var sampleRate = Math.max(1, parseInt(document.getElementById("samplerate").value, 10) || 44100);

    var bitDepth = Math.max(1, parseInt(document.getElementById("bitdepth").value, 10) || 16);
    var isFloat = document.getElementById("bitdepth-float").checked;
    var channels = Math.max(1, parseInt(document.getElementById("channels").value, 10) || 1);

    var numSamples = Math.round(durationSec * sampleRate);
    var bytesPerSample = Math.ceil(bitDepth / 8);
    var pcmDataBytes = numSamples * channels * bytesPerSample;

    return { durationSec: durationSec, sampleRate: sampleRate, bitDepth: bitDepth, isFloat: isFloat, channels: channels,
             numSamples: numSamples, bytesPerSample: bytesPerSample, pcmDataBytes: pcmDataBytes };
  }

  /* ---------- riga di breakdown: valore fisso o range (min–max) ---------- */

  function row(label, bytes, exact, opts) {
    opts = opts || {};
    return {
      label: label, low: bytes, high: bytes, exact: exact !== false,
      formula: opts.formula || "", tech: opts.tech || "", metaphor: opts.metaphor || "", note: opts.note || "",
    };
  }
  function rowRange(label, low, high, exact, opts) {
    opts = opts || {};
    return {
      label: label, low: low, high: high, exact: exact !== false,
      formula: opts.formula || "", tech: opts.tech || "", metaphor: opts.metaphor || "", note: opts.note || "",
    };
  }

  /* ---------- formule riusabili ---------- */

  function pcmFormula(c) {
    return fmtN(c.durationSec, 3) + " s  ×  " + fmtN(c.sampleRate, 0) + " Hz  ×  " + c.channels +
      " canali  ×  " + c.bytesPerSample + " B/campione  =  " + fmtN(c.pcmDataBytes, 0) + " B";
  }
  function bitrateFormula(kbps, durationSec, resultBytes) {
    return fmtN(kbps, 0) + " kbps × 1000 × " + fmtN(durationSec, 3) + " s ÷ 8  =  " + fmtN(resultBytes, 0) + " B";
  }
  function ratioFormula(pcmBytes, ratio, resultBytes) {
    return fmtN(pcmBytes, 0) + " B PCM  ×  " + Math.round(ratio * 100) + "%  =  " + fmtN(resultBytes, 0) + " B";
  }

  /* ---------- libreria di spiegazioni (tecnica + metafora) riusabili ---------- */

  var E = {
    riffHeader: {
      tech: "Le prime 12 byte identificano il file: 4 byte con la sigla “RIFF”, 4 byte con la dimensione totale del file, 4 byte con la sigla “WAVE” che dice di che tipo di RIFF si tratta.",
      metaphor: "È la copertina del pacco: c'è scritto “questo è un pacco”, quanto pesa in tutto, e cosa contiene — prima ancora di aprirlo.",
    },
    fmtChunk: function (ext) {
      return {
        tech: "Descrive come sono fatti i campioni audio: canali, sample rate, bit per campione." + (ext ? " La variante estesa (WAVE_FORMAT_EXTENSIBLE) aggiunge una mappa dei canali e il formato preciso, necessaria oltre 2 canali o con virgola mobile." : ""),
        metaphor: "È la scheda tecnica dentro il pacco: “liquido da conservare a 4°C, in bottiglie da 33cl”. Senza, il resto dei dati sarebbero solo numeri senza senso.",
      };
    },
    factChunk: {
      tech: "Dichiara il numero totale di campioni per canale; obbligatorio per i formati non-PCM semplici (es. virgola mobile), dove il numero di campioni non si deduce in modo univoco dalla sola dimensione del chunk dati.",
      metaphor: "Un bigliettino extra che dice “dentro ci sono esattamente 441.000 pezzi”, usato quando il modo in cui sono confezionati non permette di contarli guardando solo il peso della scatola.",
    },
    dataChunkHeader: {
      tech: "Etichetta il blocco successivo come “data” e ne dichiara la lunghezza in byte.",
      metaphor: "Il cartellino “CONTENUTO” attaccato alla scatola vera e propria, con scritto quanto è piena.",
    },
    pcmPayload: {
      tech: "Numero di campioni per canale (durata × sample rate) moltiplicato per i canali e per i byte occupati da ogni campione.",
      metaphor: "Scatti una foto (campione) N volte al secondo, per ogni orecchio (canale): il totale degli scatti, ognuno di un certo peso, è il “rullino” audio.",
    },
    padding: {
      tech: "I chunk RIFF/IFF devono avere lunghezza pari (allineati a 2 byte): se i dati audio occupano un numero dispari di byte si aggiunge 1 byte di riempimento, ignorato in lettura.",
      metaphor: "Un foglio in più messo nella scatola solo per far chiudere bene il coperchio, anche se non serve a nulla dentro.",
    },
    formHeader: {
      tech: "Stessa funzione del RIFF header di WAV, ma nel formato IFF di Apple/SGI: 4 byte “FORM”, 4 byte dimensione, 4 byte “AIFF”. Big-endian: i byte dei numeri sono in ordine opposto rispetto a WAV.",
      metaphor: "La stessa copertina del pacco RIFF, ma scritta in una “lingua” che legge le cifre dei numeri da un verso diverso.",
    },
    commChunk: {
      tech: "Contiene canali, numero di sample frame, bit per campione e il sample rate scritto come numero in virgola mobile esteso a 80 bit, per rappresentarlo senza arrotondamenti.",
      metaphor: "La stessa scheda tecnica del fmt di WAV, ma con il prezzo scritto con più cifre decimali del necessario, giusto per non perdere mai un centesimo.",
    },
    ssndHeader: {
      tech: "Header più due campi (offset, blockSize) quasi sempre a zero, pensati storicamente per allineare i dati in memoria; segue l'audio vero e proprio.",
      metaphor: "Un modulo con due caselle “da compilare solo in casi speciali” che restano quasi sempre bianche.",
    },
    bext: {
      tech: "602 byte fissi: descrizione, chi ha originato il file, un riferimento, data/ora di origine, timecode di partenza, identificativo UMID, valori di loudness — pensati per la tracciabilità in produzione broadcast.",
      metaphor: "Il cartellino identificativo di un pacco professionale: chi l'ha spedito, quando, con quale codice di tracciamento — cose che un WAV “normale” non porta con sé.",
    },
    rf64Header: {
      tech: "Stessa struttura del RIFF, ma la sigla è “RF64” e il campo dimensione è impostato a un valore sentinella (tutti 1): la dimensione vera si trova nel chunk ds64 che segue.",
      metaphor: "La copertina del pacco dice “il peso vero è scritto sull'etichetta extra”, perché la casella del peso su questa copertina è troppo piccola.",
    },
    ds64: {
      tech: "I campi a 32 bit di RIFF arrivano al massimo a ~4.294.967.295: oltre i 4GB non bastano. Il chunk ds64 li 'raddoppia' a 64 bit, scritto subito dopo l'header.",
      metaphor: "Un'etichetta supplementare con il vero peso del pacco, perché la bilancia sull'etichetta ufficiale ha solo 3 cifre e il pacco pesa di più.",
    },
    w64ChunkHeader: {
      tech: "Ogni blocco è identificato da un GUID a 16 byte invece che da 4 caratteri ASCII, più una dimensione a 64 bit invece che 32: molto più difficile da confondere con altri dati, e senza limite pratico di dimensione.",
      metaphor: "Anziché chiamare qualcuno per nome (che può ripetersi), lo identifichi col codice fiscale: più lungo da scrivere, ma inequivocabile anche in file enormi.",
    },
    w64WaveGuid: {
      tech: "GUID che identifica il tipo di contenuto come “wave”, equivalente concettuale della sigla “WAVE” di un file RIFF ma con lo stesso identificatore lungo e univoco.",
      metaphor: "Il timbro “contenuto: audio wave”, ma scritto con lo stesso codice a barre lungo usato per ogni altra etichetta del file.",
    },
    cafHeader: {
      tech: "8 byte: la sigla “caff”, un numero di versione e dei flag. Molto più corto dell'header RIFF perché CAF non ha bisogno di dichiarare qui la dimensione totale.",
      metaphor: "Un timbro minimale sulla prima pagina: “questo è un documento CAF, versione 1”, senza altri dettagli.",
    },
    cafDesc: {
      tech: "32 byte con sample rate (virgola mobile doppia precisione), formato audio, byte per pacchetto, frame per pacchetto, canali per frame e bit per canale.",
      metaphor: "La carta d'identità del file, su un modulo più moderno e più preciso di quello di WAV.",
    },
    cafData: {
      tech: "Header del chunk dati più un contatore “edit count” (usato per rilevare modifiche in-place), poi l'audio vero e proprio.",
      metaphor: "Il cartellino “CONTENUTO”, con in più un piccolo contachilometri che segna quante volte la scatola è stata riaperta e richiusa.",
    },
    lossyPayload: {
      tech: "Il bitrate è quanti bit al secondo l'encoder si impegna a produrre in media; moltiplicandolo per la durata e dividendo per 8 (bit → byte) si ottiene il peso dei dati audio compressi.",
      metaphor: "Un rubinetto che eroga dati a portata costante (il bitrate): lasciato aperto per N secondi, il totale raccolto è portata × tempo.",
    },
    id3v2: {
      tech: "Blocco di metadati (titolo, artista, eventuale copertina) all'inizio del file MP3, con header proprio e una serie di “frame” interni per ogni informazione.",
      metaphor: "L'etichetta con lista ingredienti e foto del prodotto, incollata sopra la scatola: non è il contenuto, ma lo accompagna.",
    },
    id3v1: {
      tech: "128 byte fissi in fondo al file (titolo, artista, album, anno, commento, genere): formato storico, ormai raramente usato da solo.",
      metaphor: "Un bigliettino minuscolo, sempre della stessa dimensione, spillato in fondo — la versione “francobollo” delle informazioni sul brano.",
    },
    mp4Ftyp: {
      tech: "Dichiara il tipo di file e le versioni di compatibilità del contenitore MP4/M4A.",
      metaphor: "La copertina del libro che dice subito “in che lingua è scritto”, prima ancora di aprirlo.",
    },
    mp4Moov: function (perFrameLabel) {
      return {
        tech: "Contiene tutte le tabelle che dicono dove si trova e quanto pesa ciascun frame audio: cresce con il numero di frame perché serve una voce per ciascuno (tabella “stsz”).",
        metaphor: "L'indice dettagliato del libro: per ogni " + perFrameLabel + " dice a che pagina inizia e quanto è lunga.",
      };
    },
    mp4Mdat: {
      tech: "Contenitore “grezzo” dei dati audio veri e propri, senza altra struttura interna: le tabelle in moov dicono come tagliarlo a fette.",
      metaphor: "Le pagine vere e proprie del libro, senza numeri né titoli stampati sopra: quelli stanno nell'indice.",
    },
    oggIdHeader: {
      tech: "Primo pacchetto Vorbis (30 byte): versione, canali, sample rate, bitrate massimo/nominale/minimo dichiarati, dimensione dei blocchi di trasformata.",
      metaphor: "Il biglietto da visita del flusso audio: chi è, a che velocità parla, prima ancora di dire una parola di contenuto.",
    },
    oggCommentSetup: {
      tech: "Il pacchetto commenti porta i tag testuali; il pacchetto setup porta i “codebook”, le tabelle di codifica costruite su misura dall'encoder — pesano tipicamente 2–4 KB e vanno lette prima di decodificare anche un solo frame.",
      metaphor: "Come spedirsi un dizionario personalizzato prima di scriversi messaggi in codice: il dizionario è pesante da mandare una volta sola, ma dopo i messaggi (i frame audio) sono molto più corti.",
    },
    oggPageOverhead: function () {
      return {
        tech: "Ogni pagina Ogg ha un header di almeno 27 byte (numero di sequenza, checksum, flag) più una tabella che spezza il payload in segmenti da massimo 255 byte: l'audio viene impacchettato in tante pagine successive.",
        metaphor: "Il flusso audio spedito come tante buste postali numerate in ordine, ciascuna con mittente e controllo antimanomissione scritto sopra.",
      };
    },
    opusHead: {
      tech: "19 byte: canali, un valore di pre-skip per l'allineamento, il sample rate originale e il guadagno di uscita consigliato.",
      metaphor: "Il biglietto da visita di Opus — essenziale, poche righe con l'indispensabile.",
    },
    opusTags: {
      tech: "Metadati testuali (spesso vuoti o minimi): stringa del produttore del file più eventuali commenti.",
      metaphor: "Un post-it con scritto solo “creato da...”, molto più corto del dossier di commenti di Vorbis.",
    },
    flacMarker: {
      tech: "4 byte con la sigla ASCII “fLaC” che identificano il file.",
      metaphor: "Il timbro sulla prima pagina che dice semplicemente “questo è un FLAC”.",
    },
    flacStreaminfo: {
      tech: "Blocco a lunghezza fissa (34 byte): sample rate, canali, bit per campione, numero totale di campioni e un'impronta MD5 dell'audio non compresso, per verificarne l'integrità dopo la decompressione.",
      metaphor: "Il “DNA” del file: le sue misure esatte più un'impronta digitale che permette di controllare, a lavoro finito, che non si sia corrotto nulla per strada.",
    },
    flacSeektable: {
      tech: "Elenco di punti (posizione nel file + istante temporale) che permettono al player di saltare avanti/indietro senza dover decomprimere tutto da capo.",
      metaphor: "I segnalibri messi ogni tot pagine in un libro, per non dover rileggere tutto da capo quando si cerca un punto preciso.",
    },
    flacVorbisComment: {
      tech: "Blocco standard (nome ereditato da Vorbis) usato da FLAC per i tag testuali: titolo, artista, album...",
      metaphor: "La copertina con le informazioni del disco, incollata sulla custodia.",
    },
    flacPadding: {
      tech: "Spazio vuoto riservato all'inizio del file: se in futuro si allungano i tag, il lettore/editor può riempirlo senza dover riscrivere tutto il file spostando l'audio.",
      metaphor: "Pagine bianche lasciate all'inizio di un quaderno, per poterci scrivere un indice più lungo in futuro senza ricopiare tutto il quaderno.",
    },
    losslessPayload: {
      tech: "Ogni frame applica un predittore (stima il campione successivo da quelli precedenti) e codifica solo l'errore di previsione, spesso molto più piccolo del campione originale: il risparmio dipende da quanto il segnale è “prevedibile”.",
      metaphor: "Invece di riscrivere ogni numero di una sequenza regolare, scrivi solo “come previsto” o la piccola differenza dal previsto: più la sequenza è regolare, meno scrivi.",
    },
    asfHeader: {
      tech: "Contenitore di più “oggetti”: proprietà del file (durata, dimensione), proprietà dello stream audio (codec, bitrate), estensioni, descrizione del contenuto (titolo/artista).",
      metaphor: "Un raccoglitore con più schede dentro: una scheda tecnica del contenitore, una del contenuto audio, un'anagrafica del brano.",
    },
    asfDataHeader: {
      tech: "Object ID (16) + Object Size (8) + File ID (16) + Total Data Packets (8) + Reserved (2): la parte fissa dell'oggetto Data, prima che comincino i pacchetti audio veri e propri.",
      metaphor: "Il cartellino che dice “da qui in poi cominciano le fette del brano, e sono in tutto N”.",
    },
    asfPacketOverhead: {
      tech: "I dati audio sono spezzati in pacchetti di dimensione fissa (qui 4096 byte) per permettere lo streaming; ogni pacchetto porta un piccolo header proprio.",
      metaphor: "Il brano tagliato a fette di uguale spessore, ciascuna con una piccola etichetta, così può essere “consumato” un pezzo alla volta anche mentre arriva.",
    },
    asfIndex: {
      tech: "Tabella opzionale in fondo al file con, per ogni secondo circa, l'offset del pacchetto corrispondente: serve per il seek veloce.",
      metaphor: "I numeri di posizione segnati ogni tot minuti su una cassetta con timer: sai subito dove far saltare la testina.",
    },
  };

  /* ---------- campi extra per formati lossy (CBR/ABR/VBR) ---------- */

  function lossyFieldsHTML(id, def) {
    return (
      '<div class="field">' +
        '<label>modalità</label>' +
        '<div class="mode-toggle" data-mode-group="' + id + '">' +
          '<button type="button" data-mode="cbr" aria-pressed="true">CBR</button>' +
          '<button type="button" data-mode="abr" aria-pressed="false">ABR (media)</button>' +
          '<button type="button" data-mode="vbr" aria-pressed="false">VBR (range)</button>' +
        '</div>' +
      '</div>' +
      '<div class="field" data-mode-field="' + id + '-single">' +
        '<label>bitrate (kbps)</label>' +
        '<input type="number" min="8" max="600" step="1" id="' + id + '-kbps" value="' + def.kbps + '">' +
      '</div>' +
      '<div class="field" data-mode-field="' + id + '-range" style="display:none">' +
        '<label>bitrate min (kbps)</label>' +
        '<input type="number" min="6" max="600" step="1" id="' + id + '-min" value="' + def.min + '">' +
      '</div>' +
      '<div class="field" data-mode-field="' + id + '-range" style="display:none">' +
        '<label>bitrate max (kbps)</label>' +
        '<input type="number" min="6" max="600" step="1" id="' + id + '-max" value="' + def.max + '">' +
      '</div>'
    );
  }

  function getPressedMode(id) {
    var group = document.querySelector('[data-mode-group="' + id + '"]');
    var btn = group && group.querySelector('button[aria-pressed="true"]');
    return btn ? btn.getAttribute("data-mode") : null;
  }
  function getLossyMode(id) {
    return getPressedMode(id) || "cbr";
  }
  function getLossyBitrate(id) {
    var mode = getLossyMode(id);
    if (mode === "vbr") {
      var min = parseFloat(document.getElementById(id + "-min").value) || 0;
      var max = parseFloat(document.getElementById(id + "-max").value) || 0;
      return { mode: mode, min: Math.min(min, max), max: Math.max(min, max) };
    }
    var kbps = parseFloat(document.getElementById(id + "-kbps").value) || 0;
    return { mode: mode, kbps: kbps };
  }
  function payloadFromBitrate(kbps, durationSec) {
    return (kbps * 1000 * durationSec) / 8;
  }

  function ratioFieldHTML(id, options, def) {
    var opts = options.map(function (o) {
      return '<option value="' + o.v + '"' + (o.v === def ? " selected" : "") + '>' + o.l + "</option>";
    }).join("");
    return (
      '<div class="field">' +
        '<label>rapporto di compressione stimato</label>' +
        '<select id="' + id + '-ratio">' + opts + "</select>" +
        '<div class="hint">dipende dal contenuto audio: transienti/rumore comprimono meno, silenzi/toni puri molto di più</div>' +
      "</div>"
    );
  }

  /* ---------- definizione formati (ordine cronologico) ---------- */

  var FORMATS = [];

  // ---- AIFF (1988) ----
  FORMATS.push({
    id: "aiff", name: "AIFF / AIFF-C", year: 1988, family: "Contenitore PCM",
    link: "https://en.wikipedia.org/wiki/Audio_Interchange_File_Format",
    linkLabel: "Wikipedia: AIFF",
    desc: "Apple/Electronic Arts, basato sul formato IFF (1985). Big-endian, un chunk COMM per i metadati audio e SSND per il payload. AIFF-C aggiunge codec compressi non standardizzati in dimensione (non calcolati qui).",
    history: "Presentato da Apple Computer nel 1988. La struttura a chunk deriva direttamente dall'IFF (Interchange File Format) che Electronic Arts aveva definito nel 1985 per l'Amiga: Apple lo adattò al Macintosh, mantenendo l'ordine dei byte big-endian tipico dei processori Motorola 68000 e poi PowerPC. È rimasto lo standard audio non compresso di riferimento nell'ecosistema Apple e nell'audio professionale (Pro Tools in primis), anche dopo l'affermarsi di WAV su altre piattaforme.",
    historyMetaphor: "Come portare in America un mobile costruito in Inghilterra: stessa struttura, stessi cassetti, ma con le cifre dei numeri “lette” nel verso opposto — la valigia (il formato IFF) è la stessa, cambia solo la mano con cui la si apre.",
    lossy: false,
    compute: function (c) {
      var rows = [];
      rows.push(row("FORM header (FORM + size + AIFF)", 12, true, { formula: "4 B “FORM” + 4 B size + 4 B “AIFF”  =  12 B", tech: E.formHeader.tech, metaphor: E.formHeader.metaphor }));
      rows.push(row("chunk COMM (metadati audio)", 26, true, { formula: "8 B header + 18 B dati (2 canali + 4 frame + 2 bit + 10 samplerate esteso)  =  26 B", tech: E.commChunk.tech, metaphor: E.commChunk.metaphor }));
      rows.push(row("chunk SSND — header", 16, true, { formula: "8 B header + 4 B offset + 4 B blockSize  =  16 B", tech: E.ssndHeader.tech, metaphor: E.ssndHeader.metaphor }));
      rows.push(row("dati audio (SSND payload)", c.pcmDataBytes, true, { formula: pcmFormula(c), tech: E.pcmPayload.tech, metaphor: E.pcmPayload.metaphor }));
      var pad = c.pcmDataBytes % 2 !== 0 ? 1 : 0;
      rows.push(row("padding byte (allineamento a parola)", pad, true, {
        formula: pad ? fmtN(c.pcmDataBytes, 0) + " è dispari → +1 B di riempimento" : fmtN(c.pcmDataBytes, 0) + " è pari → nessun byte extra necessario",
        tech: E.padding.tech, metaphor: E.padding.metaphor,
      }));
      return { rows: rows };
    },
  });

  // ---- WAV (1991) ----
  FORMATS.push({
    id: "wav", name: "WAV (RIFF/WAVE)", year: 1991, family: "Contenitore PCM",
    link: "https://en.wikipedia.org/wiki/WAV",
    linkLabel: "Wikipedia: WAV",
    desc: "Microsoft/IBM, parte della spec Multimedia PC. Little-endian, struttura a chunk RIFF. Con più di 2 canali o virgola mobile serve il fmt esteso (WAVE_FORMAT_EXTENSIBLE).",
    history: "Introdotto da Microsoft e IBM nell'agosto 1991 nella “Multimedia Programming Interface and Data Specifications 1.0”, nell'ambito dell'iniziativa Multimedia PC (MPC) che puntava a standardizzare l'hardware multimediale sui PC compatibili IBM. Come AIFF eredita la struttura a chunk dall'IFF, ma nella variante little-endian RIFF (Resource Interchange File Format), coerente con l'architettura x86. È diventato lo standard audio non compresso più diffuso al mondo.",
    historyMetaphor: "Due aziende che si siedono allo stesso tavolo e scrivono un modulo standard, buono per tutti i produttori di PC: invece che ogni scheda audio inventi il suo linguaggio, si mettono tutti d'accordo su uno stampato unico da compilare.",
    lossy: false,
    compute: function (c) {
      var rows = [];
      var useExt = c.channels > 2 || c.isFloat;
      var fmtBytes = useExt ? 48 : 24;
      var useFact = c.isFloat;
      var fc = E.fmtChunk(useExt);
      rows.push(row("RIFF header (RIFF + size + WAVE)", 12, true, { formula: "4 B “RIFF” + 4 B size + 4 B “WAVE”  =  12 B", tech: E.riffHeader.tech, metaphor: E.riffHeader.metaphor }));
      rows.push(row('chunk "fmt " ' + (useExt ? "esteso" : "standard"), fmtBytes, true, {
        formula: "8 B header + " + (useExt ? "40" : "16") + " B dati  =  " + fmtBytes + " B", tech: fc.tech, metaphor: fc.metaphor,
        note: (useExt && !useFact) ? "con WAVE_FORMAT_EXTENSIBLE su PCM intero la presenza del chunk “fact” è ambigua nella prassi: alcuni encoder lo aggiungono, altri no. Qui si assume di no." : "",
      }));
      if (useFact) rows.push(row('chunk "fact"', 12, true, { formula: "8 B header + 4 B numero campioni  =  12 B", tech: E.factChunk.tech, metaphor: E.factChunk.metaphor }));
      rows.push(row('chunk "data" — header', 8, true, { formula: "4 B “data” + 4 B size  =  8 B", tech: E.dataChunkHeader.tech, metaphor: E.dataChunkHeader.metaphor }));
      rows.push(row("dati audio (data payload)", c.pcmDataBytes, true, { formula: pcmFormula(c), tech: E.pcmPayload.tech, metaphor: E.pcmPayload.metaphor }));
      var pad = c.pcmDataBytes % 2 !== 0 ? 1 : 0;
      rows.push(row("padding byte (allineamento a parola)", pad, true, {
        formula: pad ? fmtN(c.pcmDataBytes, 0) + " è dispari → +1 B di riempimento" : fmtN(c.pcmDataBytes, 0) + " è pari → nessun byte extra necessario",
        tech: E.padding.tech, metaphor: E.padding.metaphor,
      }));
      return { rows: rows };
    },
  });

  // ---- MP3 (1993) ----
  FORMATS.push({
    id: "mp3", name: "MP3 (MPEG-1/2 Layer III)", year: 1993, family: "Lossy",
    link: "https://en.wikipedia.org/wiki/MP3",
    linkLabel: "Wikipedia: MP3",
    desc: "Algoritmo approvato nel 1992 e pubblicato come standard ISO/IEC 11172-3 nel 1993 (MPEG-1 Audio Layer III). Stream di frame (1152 campioni/frame), nessun header di file obbligatorio: la dimensione dipende dal bitrate (fisso o variabile), non dalla durata da sola.",
    history: "Gli algoritmi di compressione psicoacustica alla base del formato nascono dal lavoro di Karlheinz Brandenburg, che li sviluppò nella sua tesi di dottorato (Università di Erlangen-Norimberga, 1989) e poi come responsabile del gruppo Audio/Multimedia al Fraunhofer Institute for Integrated Circuits (IIS) di Erlangen. Standardizzato nel 1993, negli anni '90 la diffusione di lettori come Winamp e di reti come Napster ne fece il formato che cambiò per primo la distribuzione della musica digitale. Le royalty richieste dal Fraunhofer per l'uso dell'encoder/decoder furono al centro di forti polemiche, finché il programma di licenze non fu terminato ufficialmente il 23 aprile 2017.",
    historyMetaphor: "Una tesi di dottorato che, un decennio dopo, svuota gli scaffali dei negozi di dischi: il lavoro di un ricercatore in un laboratorio in Baviera finisce per riscrivere le regole di un'industria intera, un po' per merito e un po' per caso.",
    lossy: true,
    extraHTML: lossyFieldsHTML("mp3", { kbps: 192, min: 130, max: 250 })
      + '<div class="field"><label><input type="checkbox" id="mp3-id3v2"> tag ID3v2 (senza copertina)</label></div>'
      + '<div class="field"><label><input type="checkbox" id="mp3-id3v1"> tag ID3v1 (128 byte fissi)</label></div>',
    compute: function (c) {
      var rows = [];
      var br = getLossyBitrate("mp3");
      var id3v2 = document.getElementById("mp3-id3v2").checked;
      var id3v1 = document.getElementById("mp3-id3v1").checked;
      if (id3v2) rows.push(row("tag ID3v2 (senza copertina)", 210, false, { formula: "10 B header + ≈200 B frame base  =  210 B (stima)", tech: E.id3v2.tech, metaphor: E.id3v2.metaphor, note: "una copertina embeddata aggiunge in genere 20–200+ KB" }));
      if (br.mode === "vbr") {
        var payLow = payloadFromBitrate(br.min, c.durationSec);
        var payHigh = payloadFromBitrate(br.max, c.durationSec);
        rows.push(rowRange("dati audio (frame MP3, VBR)", payLow, payHigh, false, {
          formula: bitrateFormula(br.min, c.durationSec, payLow) + "  —  " + bitrateFormula(br.max, c.durationSec, payHigh),
          tech: E.lossyPayload.tech, metaphor: E.lossyPayload.metaphor,
        }));
      } else {
        var pay = payloadFromBitrate(br.kbps, c.durationSec);
        rows.push(row("dati audio (frame MP3, " + br.mode.toUpperCase() + ")", pay, br.mode === "cbr", {
          formula: bitrateFormula(br.kbps, c.durationSec, pay), tech: E.lossyPayload.tech, metaphor: E.lossyPayload.metaphor,
        }));
      }
      if (id3v1) rows.push(row("tag ID3v1 (fisso, in coda al file)", 128, true, { formula: "128 B fissi", tech: E.id3v1.tech, metaphor: E.id3v1.metaphor }));
      return { rows: rows };
    },
  });

  // ---- AAC / M4A (1997) ----
  FORMATS.push({
    id: "aac", name: "AAC (in contenitore M4A/MP4)", year: 1997, family: "Lossy",
    link: "https://en.wikipedia.org/wiki/Advanced_Audio_Coding",
    linkLabel: "Wikipedia: AAC",
    desc: "Standardizzato in MPEG-2 (1997), poi MPEG-4. Frame da 1024 campioni. Nel contenitore MP4/M4A la overhead di struttura (atomi moov/mdat) cresce leggermente con il numero di frame per via della tabella dimensioni campioni (stsz).",
    history: "Sviluppato in collaborazione tra AT&T Labs, Dolby, Fraunhofer IIS (lo stesso istituto dietro l'MP3) e Sony, per superare i limiti tecnici della famiglia MPEG-1 Layer III: più canali, frequenze di campionamento più ampie e migliore efficienza di compressione a parità di bitrate. Standardizzato nel 1997 come parte di MPEG-2 (ISO/IEC 13818-7), poi ripreso ed esteso in MPEG-4. Diventò il formato di riferimento di Apple con iTunes e iPod dal 2003, ed è oggi usato anche per lo streaming video e la radiodiffusione digitale.",
    historyMetaphor: "Quattro aziende concorrenti che si siedono allo stesso tavolo per disegnare insieme il “successore” di un formato — l'MP3 — che tutte, in fondo, avrebbero voluto essere le uniche a superare.",
    lossy: true,
    extraHTML: lossyFieldsHTML("aac", { kbps: 128, min: 96, max: 256 }),
    compute: function (c) {
      var rows = [];
      var br = getLossyBitrate("aac");
      var frames = Math.ceil(c.numSamples / 1024) || 1;
      var moovEst = 900 + frames * 4;
      var moovE = E.mp4Moov("frame audio (1024 campioni)");
      rows.push(row('atomo "ftyp"', 24, false, { formula: "size(4) + “ftyp”(4) + major_brand(4) + minor_version(4) + 2 compatible_brands(4+4)  =  24 B", tech: E.mp4Ftyp.tech, metaphor: E.mp4Ftyp.metaphor, note: "dimensione reale variabile: dipende da quanti “compatible brand” elenca l'encoder" }));
      rows.push(row('atomo "moov" (metadati + tabella campioni)', moovEst, false, { formula: "900 B base + " + fmtN(frames, 0) + " frame × 4 B  =  " + fmtN(moovEst, 0) + " B", tech: moovE.tech, metaphor: moovE.metaphor }));
      rows.push(row('atomo "mdat" — header', 8, true, { formula: "8 B fissi", tech: E.mp4Mdat.tech, metaphor: E.mp4Mdat.metaphor }));
      if (br.mode === "vbr") {
        var payLow = payloadFromBitrate(br.min, c.durationSec);
        var payHigh = payloadFromBitrate(br.max, c.durationSec);
        rows.push(rowRange("dati audio AAC (VBR)", payLow, payHigh, false, {
          formula: bitrateFormula(br.min, c.durationSec, payLow) + "  —  " + bitrateFormula(br.max, c.durationSec, payHigh),
          tech: E.lossyPayload.tech, metaphor: E.lossyPayload.metaphor,
        }));
      } else {
        var pay = payloadFromBitrate(br.kbps, c.durationSec);
        rows.push(row("dati audio AAC (" + br.mode.toUpperCase() + ")", pay, br.mode === "cbr", { formula: bitrateFormula(br.kbps, c.durationSec, pay), tech: E.lossyPayload.tech, metaphor: E.lossyPayload.metaphor }));
      }
      return { rows: rows };
    },
  });

  // ---- BWF (1997) ----
  FORMATS.push({
    id: "bwf", name: "BWF (Broadcast Wave Format)", year: 1997, family: "Contenitore PCM",
    link: "https://tech.ebu.ch/docs/tech/tech3285.pdf",
    linkLabel: "EBU Tech 3285 (BWF)",
    desc: "Standard EBU (Tech 3285, 1997): un WAV normale più il chunk bext obbligatorio, con metadati broadcast (descrizione, originatore, timecode, loudness).",
    history: "Definito dall'EBU (European Broadcasting Union) nel Tech 3285 del 1997 per rispondere a un'esigenza pratica del mondo broadcast: scambiare file audio tra stazioni, studi e attrezzature diverse mantenendo sincronizzati timecode, data/ora di origine e la tracciabilità della catena di produzione (il campo CodingHistory). La revisione del 2011 (versione 2 del bext) ha aggiunto i campi di loudness, in coincidenza con l'adozione dello standard di loudness EBU R128.",
    historyMetaphor: "Un WAV a cui viene cucita addosso la carta d'identità: prima i file giravano “anonimi” tra uno studio e l'altro, poi qualcuno ha deciso che dovevano portarsi dietro chi li ha registrati, quando, e con quale percorso.",
    lossy: false,
    compute: function (c) {
      var wav = FORMATS.filter(function (f) { return f.id === "wav"; })[0].compute(c);
      var rows = wav.rows.slice();
      rows.push(row('chunk "bext" (metadati broadcast)', 610, true, { formula: "8 B header + 602 B struttura fissa  =  610 B", tech: E.bext.tech, metaphor: E.bext.metaphor, note: "CodingHistory può estendere leggermente la dimensione minima" }));
      return { rows: rows };
    },
  });

  // ---- Wave64 (~1998) ----
  FORMATS.push({
    id: "w64", name: "Wave64 (Sony/Sonic Foundry)", year: 1998, family: "Contenitore PCM",
    link: "https://wiki.multimedia.cx/index.php/Sony_Wave64",
    linkLabel: "MultimediaWiki: Sony Wave64",
    desc: "Creato da Sonic Foundry (poi Sony) per Sound Forge, per superare il limite di ~4GB dei WAV classici: stessa logica del RIFF ma identificatori GUID a 16 byte e dimensioni a 64 bit. Anno di introduzione indicativo (fonti non concordi). Qui sono modellati solo i chunk essenziali riff/wave/fmt/data: eventuali chunk opzionali aggiuntivi (es. fact, marker, metadati) non sono conteggiati.",
    history: "Creato da Sonic Foundry per il proprio software Sound Forge, per aggirare il limite di circa 4 GB imposto dal campo dimensione a 32 bit di RIFF/WAV — un problema concreto per sessioni multitraccia lunghe o ad alta risoluzione. Sonic Foundry (e con essa Wave64) fu acquisita da Sony Pictures Digital il 31 luglio 2003, e il formato continuò a essere supportato sotto il marchio Sony Creative Software. È rimasto un formato di nicchia, usato soprattutto da chi lavora con Sound Forge o Vegas.",
    historyMetaphor: "La valigia più grande che ti compri quando quella vecchia — il WAV, fermo ai 4 GB — non si chiude più: stessa forma, stesse tasche, ma con la cerniera che questa volta regge davvero tutto.",
    lossy: false,
    compute: function (c) {
      var rows = [];
      var useExt = c.channels > 2 || c.isFloat;
      var fmtData = useExt ? 40 : 16;
      rows.push(row('chunk "riff" — header GUID + size 64-bit', 24, true, { formula: "16 B GUID + 8 B size  =  24 B", tech: E.w64ChunkHeader.tech, metaphor: E.w64ChunkHeader.metaphor }));
      rows.push(row('GUID formato "wave"', 16, true, { formula: "16 B GUID fisso", tech: E.w64WaveGuid.tech, metaphor: E.w64WaveGuid.metaphor }));
      rows.push(row('chunk "fmt " — header + dati', 24 + fmtData, true, { formula: "24 B header + " + fmtData + " B dati  =  " + (24 + fmtData) + " B", tech: E.w64ChunkHeader.tech, metaphor: "La stessa scheda tecnica del fmt di WAV, ma con l'etichetta identificativa lunga invece che a 4 lettere." }));
      rows.push(row('chunk "data" — header', 24, true, { formula: "16 B GUID + 8 B size  =  24 B", tech: E.w64ChunkHeader.tech, metaphor: E.w64ChunkHeader.metaphor }));
      rows.push(row("dati audio (data payload)", c.pcmDataBytes, true, { formula: pcmFormula(c), tech: E.pcmPayload.tech, metaphor: E.pcmPayload.metaphor }));
      var pad = c.pcmDataBytes % 2 !== 0 ? 1 : 0;
      rows.push(row("padding byte (allineamento a 2 byte)", pad, true, {
        formula: pad ? fmtN(c.pcmDataBytes, 0) + " è dispari → +1 B di riempimento" : fmtN(c.pcmDataBytes, 0) + " è pari → nessun byte extra necessario",
        tech: "Anche Wave64, pur usando dimensioni a 64 bit, allinea ogni chunk a un numero pari di byte: se il payload è dispari si aggiunge 1 byte di riempimento.",
        metaphor: E.padding.metaphor,
      }));
      return { rows: rows };
    },
  });

  // ---- WMA (1999) ----
  FORMATS.push({
    id: "wma", name: "WMA (Windows Media Audio)", year: 1999, family: "Lossy",
    link: "https://en.wikipedia.org/wiki/Windows_Media_Audio",
    linkLabel: "Wikipedia: WMA",
    desc: "Microsoft, contenitore ASF (Advanced Systems Format). Oggetto header con proprietà file/stream/metadati, oggetto dati con pacchetti a dimensione fissa (tipicamente 4096 byte), indice opzionale in coda.",
    history: "Lanciato da Microsoft il 17 agosto 1999 come parte di Windows Media Technologies 4.0 (nome interno in fase di sviluppo: MSAudio), in risposta diretta alla popolarità di MP3 e alla concorrenza di RealAudio. Fu pensato fin dall'inizio insieme a un sistema di gestione dei diritti digitali (Windows Media DRM), alla base dei primi servizi di musica a pagamento legati a Windows Media Player.",
    historyMetaphor: "Il tentativo di Microsoft di avere “il suo MP3 in casa”, ma consegnato con tanto di lucchetto: il pacco (il file) si può spedire, ma solo chi ha la chiave giusta (il DRM) può davvero aprirlo.",
    lossy: true,
    extraHTML: lossyFieldsHTML("wma", { kbps: 128, min: 64, max: 320 }),
    compute: function (c) {
      var rows = [];
      var br = getLossyBitrate("wma");
      var packetSize = 4096;
      var idxBytes = Math.round(c.durationSec) * 8;
      rows.push(row("ASF Header Object (proprietà file/stream/contenuto)", 2000, false, { formula: "≈2.000 B (stima tipica)", tech: E.asfHeader.tech, metaphor: E.asfHeader.metaphor, note: "varia con i metadati presenti" }));
      rows.push(row("ASF Data Object — header", 50, true, { formula: "16 B Object ID + 8 B Object Size + 16 B File ID + 8 B Total Data Packets + 2 B Reserved  =  50 B", tech: E.asfDataHeader.tech, metaphor: E.asfDataHeader.metaphor }));
      rows.push(row("Index Object opzionale (seek veloce)", idxBytes, false, { formula: fmtN(Math.round(c.durationSec), 0) + " punti × 8 B  =  " + fmtN(idxBytes, 0) + " B", tech: E.asfIndex.tech, metaphor: E.asfIndex.metaphor }));
      function packOverhead(payload) { return Math.ceil(payload / packetSize) * 10; }
      if (br.mode === "vbr") {
        var payLow = payloadFromBitrate(br.min, c.durationSec), povLow = packOverhead(payLow);
        var payHigh = payloadFromBitrate(br.max, c.durationSec), povHigh = packOverhead(payHigh);
        rows.push(rowRange("dati audio + overhead pacchetti (VBR)", payLow + povLow, payHigh + povHigh, false, {
          formula: bitrateFormula(br.min, c.durationSec, payLow) + " + overhead  —  " + bitrateFormula(br.max, c.durationSec, payHigh) + " + overhead",
          tech: E.asfPacketOverhead.tech, metaphor: E.asfPacketOverhead.metaphor,
        }));
      } else {
        var pay = payloadFromBitrate(br.kbps, c.durationSec), pov = packOverhead(pay);
        rows.push(row("dati audio + overhead pacchetti (" + br.mode.toUpperCase() + ")", pay + pov, false, {
          formula: bitrateFormula(br.kbps, c.durationSec, pay) + "  +  " + Math.ceil(pay / packetSize) + " pacchetti × 10 B  =  " + fmtN(pay + pov, 0) + " B",
          tech: E.asfPacketOverhead.tech, metaphor: E.asfPacketOverhead.metaphor,
        }));
      }
      return { rows: rows };
    },
  });

  // ---- OGG Vorbis (2000) ----
  FORMATS.push({
    id: "ogg", name: "Ogg Vorbis", year: 2000, family: "Lossy",
    link: "https://en.wikipedia.org/wiki/Vorbis",
    linkLabel: "Wikipedia: Vorbis",
    desc: "Xiph.Org, beta nel 2000, 1.0 nel 2002. Contenitore Ogg a pagine (header ≥27 byte + tabella segmenti). Tre pacchetti di setup iniziali: identificazione, commenti, codebook (quest'ultimo tipicamente il più pesante).",
    history: "Il progetto nacque nel 1993 per iniziativa di Christopher “Monty” Montgomery, ma lo sviluppo intensivo partì solo nel settembre 1998, quando il Fraunhofer Institute annunciò l'introduzione di royalty per l'uso dell'encoder/decoder MP3: la comunità Xiph.Org creò Vorbis come alternativa audio libera da brevetti. La prima beta pubblica arrivò nel 2000, la versione 1.0 stabile il 19 luglio 2002.",
    historyMetaphor: "Una comunità che, sentendosi chiedere il pedaggio su una strada che credeva pubblica, ne costruisce una nuova un chilometro più in là — gratuita, aperta a chiunque voglia percorrerla.",
    lossy: true,
    extraHTML: lossyFieldsHTML("ogg", { kbps: 160, min: 96, max: 256 }),
    compute: function (c) {
      var rows = [];
      var br = getLossyBitrate("ogg");
      var pageSize = 4096;
      var oh = E.oggPageOverhead();
      rows.push(row("pagina Ogg + pacchetto identificazione", 58, true, { formula: "27 B header pagina + 1 B tabella + 30 B pacchetto  =  58 B", tech: E.oggIdHeader.tech, metaphor: E.oggIdHeader.metaphor }));
      rows.push(row("pacchetto commenti + pacchetto setup/codebook", 2600, false, { formula: "≈2.600 B (stima, dipende dall'encoder)", tech: E.oggCommentSetup.tech, metaphor: E.oggCommentSetup.metaphor, note: "il setup header è tipicamente 2–4 KB" }));
      function pageOverhead(payload) { return Math.ceil(payload / pageSize) * 28; }
      if (br.mode === "vbr") {
        var payLow = payloadFromBitrate(br.min, c.durationSec), poLow = pageOverhead(payLow);
        var payHigh = payloadFromBitrate(br.max, c.durationSec), poHigh = pageOverhead(payHigh);
        rows.push(rowRange("dati audio + overhead pagine (VBR)", payLow + poLow, payHigh + poHigh, false, {
          formula: bitrateFormula(br.min, c.durationSec, payLow) + " + pagine  —  " + bitrateFormula(br.max, c.durationSec, payHigh) + " + pagine",
          tech: oh.tech, metaphor: oh.metaphor,
        }));
      } else {
        var pay = payloadFromBitrate(br.kbps, c.durationSec), po = pageOverhead(pay);
        rows.push(row("dati audio + overhead pagine (" + br.mode.toUpperCase() + ")", pay + po, false, {
          formula: bitrateFormula(br.kbps, c.durationSec, pay) + "  +  " + Math.ceil(pay / pageSize) + " pagine × 28 B  =  " + fmtN(pay + po, 0) + " B",
          tech: oh.tech, metaphor: oh.metaphor,
        }));
      }
      return { rows: rows };
    },
  });

  // ---- FLAC (2001) ----
  FORMATS.push({
    id: "flac", name: "FLAC", year: 2001, family: "Lossless compresso",
    link: "https://en.wikipedia.org/wiki/FLAC",
    linkLabel: "Wikipedia: FLAC",
    desc: "Xiph.Org / Josh Coalson. Blocchi di metadati (STREAMINFO obbligatorio, SEEKTABLE, VORBIS_COMMENT, PADDING) seguiti dai frame audio compressi senza perdita. Il rapporto di compressione dipende dal contenuto: non è calcolabile in modo esatto dalla sola durata.",
    history: "Sviluppo iniziato nel 2000 da Josh Coalson come formato di compressione audio senza perdita di informazione: bitstream definitivo dalla versione 0.9 (31 marzo 2001), prima release 1.0 il 20 luglio 2001. Nel gennaio 2003 il progetto entrò a far parte della Xiph.Org Foundation, affiancando Vorbis e Theora nella famiglia dei formati aperti e liberi da brevetti. È oggi lo standard de facto per l'archiviazione e la distribuzione audio lossless (es. Bandcamp).",
    historyMetaphor: "Il tentativo riuscito di avere la botte piena e la moglie ubriaca: rimpicchiolire la valigia senza lasciare a casa nemmeno un calzino — tutto quello che c'era nel file originale, byte per byte, torna fuori intatto.",
    lossy: false,
    isEstimate: true,
    extraHTML: ratioFieldHTML("flac", [
      { v: 0.70, l: "leggera (~70% del PCM)" },
      { v: 0.60, l: "media (~60%)" },
      { v: 0.50, l: "buona (~50%)" },
      { v: 0.42, l: "aggressiva (~42%)" },
    ], 0.55),
    compute: function (c) {
      var rows = [];
      rows.push(row('marker "fLaC"', 4, true, { formula: "4 B fissi", tech: E.flacMarker.tech, metaphor: E.flacMarker.metaphor }));
      rows.push(row("blocco STREAMINFO (obbligatorio)", 38, true, { formula: "4 B header + 34 B dati  =  38 B", tech: E.flacStreaminfo.tech, metaphor: E.flacStreaminfo.metaphor }));
      var seekpoints = Math.max(1, Math.ceil(c.durationSec / 10));
      var seekBytes = 4 + seekpoints * 18;
      rows.push(row("blocco SEEKTABLE (1 punto ogni ~10s, assunzione)", seekBytes, false, { formula: fmtN(seekpoints, 0) + " punti × 18 B + 4 B header  =  " + fmtN(seekBytes, 0) + " B", tech: E.flacSeektable.tech, metaphor: E.flacSeektable.metaphor }));
      rows.push(row("blocco VORBIS_COMMENT (tag minimi)", 64, false, { formula: "≈64 B (vendor string + tag vuoti)", tech: E.flacVorbisComment.tech, metaphor: E.flacVorbisComment.metaphor }));
      var paddingReserve = c.durationSec > 1200 ? 65536 : 8192;
      rows.push(row("blocco PADDING (default encoder di riferimento)", 4 + paddingReserve, false, {
        formula: "4 B header + " + fmtN(paddingReserve, 0) + " B riserva  =  " + fmtN(4 + paddingReserve, 0) + " B",
        tech: E.flacPadding.tech, metaphor: E.flacPadding.metaphor,
        note: "l'encoder di riferimento usa 8.192 B di default, o 65.536 B se l'audio supera i 20 minuti; è comunque configurabile (anche 0)",
      }));
      var ratio = parseFloat(document.getElementById("flac-ratio").value) || 0.55;
      var payload = Math.round(c.pcmDataBytes * ratio);
      rows.push(row("frame audio compressi", payload, false, { formula: ratioFormula(c.pcmDataBytes, ratio, payload), tech: E.losslessPayload.tech, metaphor: E.losslessPayload.metaphor, note: "reale dipende dal contenuto del segnale" }));
      return { rows: rows };
    },
  });

  // ---- ALAC (2004) ----
  FORMATS.push({
    id: "alac", name: "ALAC (Apple Lossless)", year: 2004, family: "Lossless compresso",
    link: "https://en.wikipedia.org/wiki/Apple_Lossless_Audio_Codec",
    linkLabel: "Wikipedia: ALAC",
    desc: "Apple, introdotto il 28 aprile 2004 con QuickTime 6.5.1, reso open source nel 2011. Tipicamente in contenitore M4A/MP4 (o CAF). Frame da 4096 campioni; compressione senza perdita, tipicamente un po' meno aggressiva di FLAC.",
    history: "Presentato da Apple il 28 aprile 2004 con l'aggiornamento a QuickTime 6.5.1, come alternativa lossless proprietaria pensata per l'ecosistema iTunes/iPod. Rimase un formato chiuso per sette anni, finché Apple non lo rese open source il 27 ottobre 2011 (licenza Apache 2.0), permettendone il supporto anche su piattaforme non Apple.",
    historyMetaphor: "Una ricetta di cucina tenuta in un cassetto chiuso a chiave per sette anni, poi un giorno lasciata lì, aperta, con un biglietto: “servitevi pure”.",
    lossy: false,
    isEstimate: true,
    extraHTML: ratioFieldHTML("alac", [
      { v: 0.75, l: "leggera (~75% del PCM)" },
      { v: 0.65, l: "media (~65%)" },
      { v: 0.55, l: "buona (~55%)" },
    ], 0.62),
    compute: function (c) {
      var rows = [];
      var frames = Math.ceil(c.numSamples / 4096) || 1;
      var moovEst = 1200 + frames * 4;
      var moovE = E.mp4Moov("frame audio (4096 campioni)");
      rows.push(row('atomo "ftyp"', 24, false, { formula: "size(4) + “ftyp”(4) + major_brand(4) + minor_version(4) + 2 compatible_brands(4+4)  =  24 B", tech: E.mp4Ftyp.tech, metaphor: E.mp4Ftyp.metaphor, note: "dimensione reale variabile: dipende da quanti “compatible brand” elenca l'encoder" }));
      rows.push(row('atomo "moov" (magic cookie ALAC + tabella campioni)', moovEst, false, { formula: "1.200 B base + " + fmtN(frames, 0) + " frame × 4 B  =  " + fmtN(moovEst, 0) + " B", tech: moovE.tech, metaphor: moovE.metaphor }));
      rows.push(row('atomo "mdat" — header', 8, true, { formula: "8 B fissi", tech: E.mp4Mdat.tech, metaphor: E.mp4Mdat.metaphor }));
      var ratio = parseFloat(document.getElementById("alac-ratio").value) || 0.62;
      var payload = Math.round(c.pcmDataBytes * ratio);
      rows.push(row("frame audio compressi", payload, false, { formula: ratioFormula(c.pcmDataBytes, ratio, payload), tech: E.losslessPayload.tech, metaphor: E.losslessPayload.metaphor, note: "reale dipende dal contenuto del segnale" }));
      return { rows: rows };
    },
  });

  // ---- CAF (2005) ----
  FORMATS.push({
    id: "caf", name: "CAF (Core Audio Format)", year: 2005, family: "Contenitore PCM",
    link: "https://developer.apple.com/library/archive/documentation/MusicAudio/Reference/CAFSpec/CAF_intro/CAF_intro.html",
    linkLabel: "Apple: CAF Spec",
    desc: "Apple, introdotto nel 2005 con Mac OS X 10.4. Contenitore flessibile senza i limiti di 4GB del WAV; qui trattato come contenitore PCM lineare (desc + data). Può anche incapsulare ALAC o altri codec via chunk aggiuntivi (pakt).",
    history: "Introdotto da Apple con Mac OS X 10.4 “Tiger” (aprile 2005) come parte del framework Core Audio, per superare i limiti strutturali di WAV e AIFF — campi dimensione a 32 bit e quindi il tetto dei 4 GB — e offrire un contenitore più flessibile, capace di incapsulare sia PCM lineare sia formati compressi come ALAC.",
    historyMetaphor: "Un baule “universale” costruito apposta perché smettesse di essere un problema quello che ci metti dentro: audio non compresso, compresso, con qualunque numero di canali — il baule si adatta, non il contrario.",
    lossy: false,
    compute: function (c) {
      var rows = [];
      rows.push(row('file header ("caff" + versione + flag)', 8, true, { formula: "4 B “caff” + 2 B versione + 2 B flag  =  8 B", tech: E.cafHeader.tech, metaphor: E.cafHeader.metaphor }));
      rows.push(row('chunk "desc" (Audio Description)', 44, true, { formula: "12 B header + 32 B dati  =  44 B", tech: E.cafDesc.tech, metaphor: E.cafDesc.metaphor }));
      rows.push(row('chunk "data" — header', 16, true, { formula: "12 B header + 4 B edit count  =  16 B", tech: E.cafData.tech, metaphor: E.cafData.metaphor }));
      rows.push(row("dati audio (data payload)", c.pcmDataBytes, true, { formula: pcmFormula(c), tech: E.pcmPayload.tech, metaphor: E.pcmPayload.metaphor }));
      return { rows: rows };
    },
  });

  // ---- RF64 (2007) ----
  FORMATS.push({
    id: "rf64", name: "RF64", year: 2007, family: "Contenitore PCM",
    link: "https://tech.ebu.ch/publications/tech3306",
    linkLabel: "EBU Tech 3306 (RF64)",
    desc: "EBU Tech 3306 (v1.0, febbraio 2007): estende il WAV oltre i 4GB. Header 'RF64' con size sentinella, seguito dal chunk obbligatorio ds64 con le dimensioni reali a 64 bit.",
    history: "Pubblicato dall'EBU come Tech 3306 nel febbraio 2007, per dare all'industria broadcast e della produzione audio uno standard aperto — alternativo al Wave64 proprietario di Sony — con cui superare il limite dei 4 GB restando il più possibile vicino al RIFF/WAV classico nella struttura a chunk. Non è però compatibile a livello di lettura diretta: un parser che riconosce solo la sigla letterale “RIFF” non apre un file RF64, perché la sigla è sostituita da “RF64”.",
    historyMetaphor: "Lo stesso identikit del WAV — stessa faccia, stessi tratti — ma con un nome diverso scritto sul citofono: chi suona chiedendo di “RIFF”, a “RF64” non riceve risposta, anche se dentro casa vive praticamente la stessa famiglia.",
    lossy: false,
    compute: function (c) {
      var rows = [];
      var useExt = c.channels > 2 || c.isFloat;
      var fmtBytes = useExt ? 48 : 24;
      var useFact = c.isFloat;
      var fc = E.fmtChunk(useExt);
      rows.push(row("header RF64 (size sentinella)", 12, true, { formula: "4 B “RF64” + 4 B size sentinella + 4 B “WAVE”  =  12 B", tech: E.rf64Header.tech, metaphor: E.rf64Header.metaphor }));
      rows.push(row('chunk "ds64" obbligatorio', 36, true, { formula: "8 B header + 28 B dimensioni reali a 64-bit  =  36 B", tech: E.ds64.tech, metaphor: E.ds64.metaphor }));
      rows.push(row('chunk "fmt " ' + (useExt ? "esteso" : "standard"), fmtBytes, true, {
        formula: "8 B header + " + (useExt ? "40" : "16") + " B dati  =  " + fmtBytes + " B", tech: fc.tech, metaphor: fc.metaphor,
        note: (useExt && !useFact) ? "con WAVE_FORMAT_EXTENSIBLE su PCM intero la presenza del chunk “fact” è ambigua nella prassi: alcuni encoder lo aggiungono, altri no. Qui si assume di no." : "",
      }));
      if (useFact) rows.push(row('chunk "fact"', 12, true, { formula: "8 B header + 4 B numero campioni  =  12 B", tech: E.factChunk.tech, metaphor: E.factChunk.metaphor }));
      rows.push(row('chunk "data" — header (size sentinella)', 8, true, { formula: "4 B “data” + 4 B size sentinella  =  8 B", tech: E.dataChunkHeader.tech, metaphor: E.dataChunkHeader.metaphor }));
      rows.push(row("dati audio (data payload)", c.pcmDataBytes, true, { formula: pcmFormula(c), tech: E.pcmPayload.tech, metaphor: E.pcmPayload.metaphor }));
      var pad = c.pcmDataBytes % 2 !== 0 ? 1 : 0;
      rows.push(row("padding byte", pad, true, {
        formula: pad ? fmtN(c.pcmDataBytes, 0) + " è dispari → +1 B di riempimento" : fmtN(c.pcmDataBytes, 0) + " è pari → nessun byte extra necessario",
        tech: E.padding.tech, metaphor: E.padding.metaphor,
      }));
      return { rows: rows };
    },
  });

  // ---- Opus (2012) ----
  FORMATS.push({
    id: "opus", name: "Opus", year: 2012, family: "Lossy",
    link: "https://en.wikipedia.org/wiki/Opus_(audio_format)",
    linkLabel: "Wikipedia: Opus",
    desc: "IETF RFC 6716 (2012). Anche lui in contenitore Ogg a pagine, ma senza il pesante codebook di Vorbis: header OpusHead (19 B) e OpusTags molto più leggeri.",
    history: "Nato dalla fusione di due codec sviluppati separatamente: SILK di Skype (ottimizzato per la voce) e CELT di Xiph.Org (a bassa latenza, pensato per la musica). Standardizzato dall'IETF come RFC 6716 nel settembre 2012, con l'obiettivo dichiarato di essere libero da royalty e versatile su tutto lo spettro di bitrate (6–510 kbps) e di casi d'uso: dalla voce in tempo reale — oggi alla base di WebRTC e di app come Discord — alla musica in streaming.",
    historyMetaphor: "Due specialisti messi nella stessa squadra: uno che sa parlare benissimo (SILK, per la voce) e uno che sa suonare benissimo (CELT, per la musica), fusi in un solo giocatore capace di fare bene entrambe le cose.",
    lossy: true,
    extraHTML: lossyFieldsHTML("opus", { kbps: 128, min: 64, max: 256 }),
    compute: function (c) {
      var rows = [];
      var br = getLossyBitrate("opus");
      var pageSize = 4096;
      var oh = E.oggPageOverhead();
      rows.push(row("pagina Ogg + pacchetto OpusHead", 47, true, { formula: "27 B header pagina + 1 B tabella + 19 B pacchetto  =  47 B", tech: E.opusHead.tech, metaphor: E.opusHead.metaphor }));
      rows.push(row("pagina Ogg + pacchetto OpusTags", 68, false, { formula: "27 B header pagina + 1 B tabella + ≈40 B pacchetto (8 magic + 4 len + ≈24 vendor string + 4 comment count)  =  ≈68 B", tech: E.opusTags.tech, metaphor: E.opusTags.metaphor, note: "la vendor string la scrive l'encoder: lunghezza reale variabile" }));
      function pageOverhead(payload) { return Math.ceil(payload / pageSize) * 28; }
      if (br.mode === "vbr") {
        var payLow = payloadFromBitrate(br.min, c.durationSec), poLow = pageOverhead(payLow);
        var payHigh = payloadFromBitrate(br.max, c.durationSec), poHigh = pageOverhead(payHigh);
        rows.push(rowRange("dati audio + overhead pagine (VBR)", payLow + poLow, payHigh + poHigh, false, {
          formula: bitrateFormula(br.min, c.durationSec, payLow) + " + pagine  —  " + bitrateFormula(br.max, c.durationSec, payHigh) + " + pagine",
          tech: oh.tech, metaphor: oh.metaphor,
        }));
      } else {
        var pay = payloadFromBitrate(br.kbps, c.durationSec), po = pageOverhead(pay);
        rows.push(row("dati audio + overhead pagine (" + br.mode.toUpperCase() + ")", pay + po, false, {
          formula: bitrateFormula(br.kbps, c.durationSec, pay) + "  +  " + Math.ceil(pay / pageSize) + " pagine × 28 B  =  " + fmtN(pay + po, 0) + " B",
          tech: oh.tech, metaphor: oh.metaphor,
        }));
      }
      return { rows: rows };
    },
  });

  FORMATS.sort(function (a, b) { return a.year - b.year; });

  /* ---------- rendering ---------- */

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function buildIndex() {
    var ul = document.getElementById("format-index");
    ul.innerHTML = "";
    FORMATS.forEach(function (f) {
      var li = document.createElement("li");
      li.innerHTML = '<span class="yr">' + f.year + "</span>" +
        '<a class="tui-link" href="#fmt-' + f.id + '" data-label="' + f.name.split(" (")[0] + '"></a>';
      ul.appendChild(li);
    });
  }

  function buildSections() {
    var container = document.getElementById("formats-container");
    container.innerHTML = "";
    FORMATS.forEach(function (f) {
      var sec = el("section", { class: "pane fmt-section", id: "fmt-" + f.id, "data-title": f.id });
      var head =
        '<div class="fmt-head"><h2>' + f.name + '</h2><span class="fmt-year">' + f.year + '</span>' +
        '<span class="fmt-family">' + f.family + "</span></div>" +
        '<p class="fmt-desc">' + f.desc + ' — <a class="ext-link" href="' + f.link + '" target="_blank" rel="noopener">' + f.linkLabel + "</a></p>" +
        (f.history ?
          '<div class="fmt-history-wrap">' +
          '<p class="fmt-history"><span class="calc-explain-label">storia</span> ' + f.history + "</p>" +
          (f.historyMetaphor ? '<p class="fmt-history-metaphor"><span class="calc-explain-label">in parole povere</span> ' + f.historyMetaphor + "</p>" : "") +
          "</div>"
          : "");
      var controls = f.extraHTML ? '<div class="fmt-controls">' + f.extraHTML + "</div>" : "";
      var body =
        '<div class="breakdown-list" data-fmt="' + f.id + '"></div>' +
        '<div class="totals-row" data-totals="' + f.id + '"></div>';
      sec.innerHTML = head + controls + body;
      container.appendChild(sec);
    });
  }

  function renderRow(r) {
    var bytesDisplay = r.low === r.high ? fmtN(r.low, 0) : fmtN(r.low, 0) + " – " + fmtN(r.high, 0);
    var badge = r.exact ? '<span class="badge exact">esatto</span>' : '<span class="badge est">stima</span>';
    var formula = r.formula ? '<div class="calc-formula">' + r.formula + "</div>" : "";
    var noteHtml = r.note ? '<div class="calc-tech"><span class="calc-explain-label">nota</span> ' + r.note + "</div>" : "";
    var explain =
      '<div class="calc-explain">' +
      (r.tech ? '<div class="calc-tech"><span class="calc-explain-label">tecnica</span> ' + r.tech + "</div>" : "") +
      (r.metaphor ? '<div class="calc-metaphor"><span class="calc-explain-label">in parole povere</span> ' + r.metaphor + "</div>" : "") +
      noteHtml +
      "</div>";
    return (
      '<div class="calc-row">' +
      '<div class="calc-row-top"><span class="calc-label">' + r.label + badge + '</span><span class="calc-bytes">' + bytesDisplay + " B</span></div>" +
      formula + explain +
      "</div>"
    );
  }

  function totalsAddition(rows) {
    var hasRange = rows.some(function (r) { return r.low !== r.high; });
    var lowSum = rows.reduce(function (a, r) { return a + r.low; }, 0);
    var lines = [];
    lines.push(
      '<div class="calc-formula total-formula">' +
      rows.map(function (r) { return fmtN(r.low, 0); }).join(" + ") + "  =  " + fmtN(lowSum, 0) + " B" + (hasRange ? " (minimo)" : "") +
      "</div>"
    );
    var highSum = lowSum;
    if (hasRange) {
      highSum = rows.reduce(function (a, r) { return a + r.high; }, 0);
      lines.push(
        '<div class="calc-formula total-formula">' +
        rows.map(function (r) { return fmtN(r.high, 0); }).join(" + ") + "  =  " + fmtN(highSum, 0) + " B (massimo)" +
        "</div>"
      );
    }
    return { html: lines.join(""), low: lowSum, high: highSum, hasRange: hasRange };
  }

  function renderTotals(target, rows) {
    var add = totalsAddition(rows);
    var labels = unitLabels(getBase());
    function line(bytes) {
      var s = sizeCols(bytes);
      return (
        '<div class="unit-line">' +
        '<span class="tot-item">bit <b>' + fmtN(s.bit, 0) + "</b></span>" +
        '<span class="tot-item">Byte <b>' + fmtN(s.byte, 0) + "</b></span>" +
        '<span class="tot-item">' + labels.k + " <b>" + fmtN(s.k) + "</b></span>" +
        '<span class="tot-item">' + labels.m + " <b>" + fmtN(s.m) + "</b></span>" +
        '<span class="tot-item">' + labels.g + " <b>" + fmtN(s.g) + "</b></span>" +
        '<span class="tot-item">' + labels.t + " <b>" + fmtN(s.t) + "</b></span>" +
        "</div>"
      );
    }
    var html = add.html;
    if (!add.hasRange) {
      html += line(add.low);
    } else {
      html += '<div class="range-label">totale minimo</div>' + line(add.low) +
        '<div class="range-label">totale massimo</div>' + line(add.high);
    }
    target.innerHTML = html;
  }

  function recalcAll() {
    var c = getCommon();
    FORMATS.forEach(function (f) {
      var out = f.compute(c);
      var listEl = document.querySelector('.breakdown-list[data-fmt="' + f.id + '"]');
      listEl.innerHTML = out.rows.map(renderRow).join("");
      var totalsEl = document.querySelector('[data-totals="' + f.id + '"]');
      renderTotals(totalsEl, out.rows);
    });
  }

  /* ---------- wiring UI ---------- */

  function wireModeToggles() {
    document.querySelectorAll("[data-mode-group]").forEach(function (group) {
      var id = group.getAttribute("data-mode-group");
      group.querySelectorAll("button").forEach(function (btn) {
        btn.addEventListener("click", function () {
          group.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
          btn.setAttribute("aria-pressed", "true");
          var mode = btn.getAttribute("data-mode");
          document.querySelectorAll('[data-mode-field="' + id + '-single"]').forEach(function (f) {
            f.style.display = mode === "vbr" ? "none" : "";
          });
          document.querySelectorAll('[data-mode-field="' + id + '-range"]').forEach(function (f) {
            f.style.display = mode === "vbr" ? "" : "none";
          });
          recalcAll();
        });
      });
    });
  }

  function wireUnitToggle() {
    var b1024 = document.getElementById("unit-1024");
    var b1000 = document.getElementById("unit-1000");
    function set(base) {
      b1024.setAttribute("aria-pressed", base === 1024 ? "true" : "false");
      b1000.setAttribute("aria-pressed", base === 1000 ? "true" : "false");
      recalcAll();
    }
    b1024.addEventListener("click", function () { set(1024); });
    b1000.addEventListener("click", function () { set(1000); });
  }

  function wirePalette() {
    var sel = document.getElementById("palette-select");
    sel.addEventListener("change", function () {
      if (sel.value === "default") document.body.removeAttribute("data-theme");
      else document.body.setAttribute("data-theme", sel.value);
    });
  }

  function wireInputs() {
    document.getElementById("common-params").addEventListener("input", recalcAll);
    document.getElementById("common-params").addEventListener("change", recalcAll);
    document.getElementById("formats-container").addEventListener("input", recalcAll);
    document.getElementById("formats-container").addEventListener("change", recalcAll);
  }

  document.addEventListener("DOMContentLoaded", function () {
    buildIndex();
    buildSections();
    wireModeToggles();
    wireUnitToggle();
    wirePalette();
    wireInputs();
    recalcAll();
  });
})();
