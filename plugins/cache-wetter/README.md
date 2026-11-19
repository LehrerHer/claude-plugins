# cache-wetter

Schmale Leiste über dem Eingabefeld von Claude Code:

1. **Cache-Restzeit** in Minuten (echte Laufzeit der Session, 5 min oder 1 h) mit 20-Kästchen-Balken: grün, im letzten Viertel gelb, in den letzten 10 % rot, bei 0 „abgelaufen“. Neu gezeichnet jede Minute.
2. **Hit-Rate** der letzten Antwort: Anteil der Input-Tokens aus dem Cache.
3. **Wetter**: ☀️ bis 50 % der Auto-Compact-Schwelle, 🌧️ bis 80 %, ⛈️ darüber (Schwelle aus der Session, sonst 83 %).
4. **Kontextfüllung** in % und die Auto-Compact-Schwelle.
5. **Compact**-Button (bei ⛈️ hervorgehoben). Läuft Claude noch oder in der Desktop-App, wird `/compact` eingereiht.
6. **▾/▸** klappt die Leiste zu: dann nur Wetter, Cache-Restzeit, Kontext.
7. Nach `/compact` oder Klick: Zeile „Tokens vorher → nachher“ und die Zusammenfassung als Log-Zeilen im Chat (das Modell liest sie nicht mit), an Absätzen geteilt.
