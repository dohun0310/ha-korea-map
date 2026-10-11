# ha-korea-map

Home Assistant 기본 지도(`/map`)의 배경 지도를 지도 중심 위치에 따라 바꿔 주는 프런트엔드 확장입니다.

- 지도 중심이 대한민국 안이면 **NAVER 지도**를 씁니다.
- 지도 중심이 해외이면 **Google 지도**를 씁니다.
- 전체 보기에 한국과 해외가 함께 들어 있으면 **Google 지도**를 씁니다.

별도 패널을 만들지 않고 HA 기본 지도 대시보드를 그대로 씁니다. 사람, 구역, 경로 마커도 그대로 유지됩니다.

## 주요 기능

- NAVER Maps JavaScript API v3와 Google Maps JavaScript API를 공식 SDK로만 불러옵니다. 비공식 타일 주소는 쓰지 않습니다.
- 지도 오른쪽 위 선택 칸에서 `자동`, `NAVER`, `Google`, `기본 지도` 중 하나를 고를 수 있습니다. 자동일 때는 `자동 (NAVER)`처럼 현재 지도가 함께 표시됩니다.
- SDK 로딩이나 인증이 실패하면 HA 원래 지도로 자동 복구합니다.
- 지원하는 HA 버전이 아니면 아무것도 바꾸지 않고 원래 지도를 그대로 둡니다.
- 대한민국 판정에는 출처가 분명한 공개 경계 데이터를 씁니다. 제주도, 마라도, 울릉도, 독도, 백령도를 포함하고 쓰시마와 북한은 제외합니다. 자세한 내용은 [data/README.md](data/README.md)에 있습니다.

## 지원 버전

| 항목 | 버전 |
|---|---|
| Home Assistant Core | 2026.10.1 |
| Frontend | 20260930.3 |

HA 내부 지도 엔진을 교체하는 방식이라 공개 API가 아닌 부분에 의존합니다. HA를 업데이트하면 확장은 스스로 꺼지고 원래 지도가 나옵니다. 새 버전에서 다시 검증한 뒤 버전 값을 갱신해야 합니다.

## 설치

[dist/INSTALL.md](dist/INSTALL.md)를 따라 설치합니다. 요약하면 다음과 같습니다.

1. `dist/ha-korea-map/` 파일을 HA의 `/config/www/ha-korea-map/`에 복사합니다.
2. `generate-provider-config.py`로 키 설정 파일을 만듭니다. 키는 저장소에 넣지 않습니다.
3. `configuration.yaml`의 `frontend.extra_module_url`에 `/local/ha-korea-map/ha-korea-map.js?v=auto-2`를 추가하고 HA를 재시작합니다.
4. `/map` 대시보드의 지도 카드에 `cluster: false`를 넣습니다.

## 알려진 한계

- NAVER 지도는 SDK 자체가 한국 범위로 고정되어 있습니다. NAVER 지도에서 손으로 끌어서 해외로 나갈 수는 없습니다. 목적지가 정해진 이동(HA 자동 맞춤 등)은 목적지 기준으로 판정해 Google로 전환합니다.
- 마커 클러스터링은 지원하지 않습니다.
- SDK 지도에는 HA 지도 스타일(다크 모드 등)이 적용되지 않습니다.
- 경계는 근사치라서 대한해협, 서해 NLL, 한강 하구 근처에서는 수 km 오차가 있을 수 있습니다.
- Google Maps Platform 약관 3.2.3(e)가 NAVER와 Google을 같은 화면에서 전환하는 이 구성에 적용되는지는 확인되지 않았습니다.
- 두 SDK 모두 사용량에 따라 요금이 발생할 수 있습니다.

## 개발

```sh
# 테스트
node --test test/*.test.mjs
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -s test -p '*test*.py'

# 대한민국 경계 다시 만들기 (메모리 상한을 걸고 실행)
OPENBLAS_NUM_THREADS=1 prlimit --as=2500000000 -- .venv/bin/python tools/build_korea_boundary.py

# 설치 패키지 다시 만들기
.venv/bin/python tools/build_dist.py
```

`config/`에는 격리 테스트용 HA 컨테이너에 마운트하는 설정이 있습니다. SDK 검증 절차와 실측 결과는 [docs/OFFICIAL-SDK.md](docs/OFFICIAL-SDK.md)에 정리되어 있습니다.

## 데이터 출처

경계 데이터는 geoBoundaries와 Natural Earth를 가공했습니다. 북한(CC BY 3.0 IGO)과 일본(CC BY 4.0) 데이터는 출처 표기가 필요합니다. 표기 문구는 [dist/ha-korea-map/ATTRIBUTION.md](dist/ha-korea-map/ATTRIBUTION.md)에 있습니다.
