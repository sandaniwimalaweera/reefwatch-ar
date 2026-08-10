# Testing Record

Evidence for the Testing & Evaluation criterion (3 marks). Fill this in as you
test, not afterwards.

## Device matrix

| Device | OS / Browser | Marker mode | Markerless mode | Live data | Notes |
|---|---|---|---|---|---|
| | Android / Chrome | | | | |
| | Android / Chrome | | | | |
| | iOS / Safari | | | | |
| | Windows / Chrome | | n/a | | |

Use: PASS / FAIL / PARTIAL / N/A

## Condition tests

| Condition | What I tested | Result | Fix applied |
|---|---|---|---|
| Bright sunlight | Marker tracking stability | | |
| Dim indoor light | Marker tracking stability | | |
| Mobile data (4G) | Model load time | | |
| Wifi | Model load time | | |
| Plain tile floor | Hit-test plane detection | | |
| Patterned carpet | Hit-test plane detection | | |
| Airplane mode | API fallback behaviour | | |

## Performance

| Metric | Target | Measured | Device |
|---|---|---|---|
| First load (4G) | under 3 s | | |
| Frame rate, marker scene | 30 fps or better | | |
| Frame rate, reef placed | 30 fps or better | | |

## Known limitations

Record anything that does not work on a given device, and the fallback you
built for it. A documented limitation with a fallback earns marks. An
undocumented one loses them.
