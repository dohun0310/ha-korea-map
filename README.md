# ha-korea-map

ha-korea-map은 Home Assistant(HA) 기본 지도(`/map`)에서 배경 지도를 지도 중심 위치에 맞춰 바꿔 주는 프런트엔드 확장입니다.

- 지도 중심이 대한민국 안에 있으면 NAVER 지도를 사용합니다.
- 지도 중심이 해외에 있으면 Google 지도를 사용합니다.
- 전체 보기에 한국과 해외 위치가 함께 들어 있으면 Google 지도를 사용합니다.

별도 패널을 만들지 않고 HA 기본 지도 대시보드를 그대로 사용합니다. 사람, 구역, 경로 마커도 그대로 표시됩니다.

## 주요 기능

- NAVER Maps JavaScript API v3와 Google Maps JavaScript API를 공식 SDK로만 불러옵니다. 비공식 타일 주소는 사용하지 않습니다.
- 지도는 항상 자동으로 선택됩니다. 지도 위에 선택 칸이나 확대·축소 버튼 같은 UI를 추가하지 않으며, 확대와 축소는 손가락, 마우스 휠, 더블클릭으로 조작합니다.
- 지도 카드의 그룹화 버튼을 켜거나 꺼도 NAVER·Google 지도를 유지합니다. 엔진을 바꿀 때에도 그룹화 설정을 그대로 적용합니다.
- HA가 다크 모드이면 제공자 지도도 어둡게 표시하고, 라이트 모드이면 밝게 표시합니다. 테마를 바꾸면 지도도 따라서 바뀝니다.
  - Google 지도는 공식 옵션인 `colorScheme`을 사용합니다. 이 옵션은 지도를 만들 때만 지정할 수 있으므로, 테마가 바뀌면 지도를 새로 만듭니다.
  - NAVER 지도는 콘솔 작업 없이 쓸 수 있는 공식 다크 옵션이 없습니다. 그래서 기본 동작으로는 타일 층에만 HA와 같은 색 반전 필터를 적용합니다. 이 필터는 공식 스타일이 아닙니다. Style Editor에서 발행한 스타일 ID를 설정하면 공식 스타일을 사용합니다.
  - 마커, 원, 경로, 로고, 저작권 표시에는 필터를 적용하지 않습니다.
- SDK를 불러오지 못하거나 인증에 실패하면 HA 원래 지도로 자동 복구합니다.
- 지원하는 HA 버전이 아니면 아무것도 바꾸지 않고 원래 지도를 그대로 둡니다.
- 대한민국 판정에는 출처가 분명한 공개 경계 데이터를 사용합니다. 제주도, 마라도, 울릉도, 독도, 백령도를 포함하고 쓰시마와 북한은 제외합니다. 자세한 내용은 [data/README.md](data/README.md)에 정리했습니다.

## 지원 버전

| 항목 | 버전 |
|---|---|
| Home Assistant Core | 2026.10.1 |
| Frontend | 20260930.3 |

이 확장은 HA 내부 지도 엔진을 교체하는 방식으로 동작하므로 공개 API가 아닌 부분에 의존합니다. HA를 업데이트하면 확장은 스스로 동작을 멈추고 원래 지도를 표시합니다. 새 버전에서 다시 검증한 다음 버전 값을 갱신해야 합니다.

## 설치

자세한 절차는 [docs/INSTALL.md](docs/INSTALL.md)에 정리했습니다. 요약하면 다음과 같습니다.

1. HACS에서 이 저장소를 Dashboard 유형의 사용자 지정 저장소로 추가하고 내려받습니다. HACS를 사용하지 않는다면 `dist/` 폴더에 있는 파일을 HA의 `/config/www/ha-korea-map/`에 복사합니다.
2. `generate-provider-config.py`로 키 설정 파일 `/config/www/ha-korea-map-config.mjs`를 만듭니다. 이 파일은 패키지 폴더 밖에 있으므로 HACS로 업데이트해도 덮어쓰지 않습니다. 키는 저장소에 넣지 않습니다.
3. `configuration.yaml`에 있는 `frontend.extra_module_url`에 `/hacsfiles/ha-korea-map/ha-korea-map.js?v=auto-4`를 추가하고 HA를 재시작합니다. 파일을 직접 복사했다면 `/local/ha-korea-map/ha-korea-map.js?v=auto-4`를 추가합니다.

HACS가 자동으로 등록하는 대시보드 리소스만으로도 동작할 수 있습니다. 다만 대시보드 리소스는 `extra_module_url`보다 늦게 불러오기 시작하므로, 첫 지도가 HA 원래 지도로 만들어질 가능성이 더 높습니다. 그래서 `extra_module_url` 등록을 권장합니다. 두 방법을 함께 등록해도 확장은 한 번만 설치됩니다.

## 알려진 한계

- NAVER SDK는 지도 범위를 한국 주변으로 제한합니다. 그래서 NAVER 지도에서 손으로 끌어서 해외로 이동할 수는 없습니다. HA 자동 맞춤처럼 목적지가 정해진 이동은 목적지를 기준으로 판정해 Google 지도로 전환합니다.
- SDK를 불러오지 못하거나 인증에 실패하면 그 페이지에서는 원래 지도를 계속 사용합니다. 새로고침하면 다시 시도합니다.
- 현재 버전은 그룹화를 켜도 제공자 지도에 그룹 아이콘을 그리지 않고 마커를 하나씩 표시합니다.
- NAVER 다크 모드에 사용하는 필터는 공식 스타일이 아니며, NAVER 약관이 타일 색 변형을 허용하는지는 확인하지 못했습니다.
- Google 지도는 테마가 바뀔 때마다 새로 만들어지므로 지도 로드 횟수가 늘어날 수 있습니다.
- 경계는 근사치이므로 대한해협, 서해 NLL, 한강 하구 근처에서는 수 km 오차가 생길 수 있습니다.
- Google Maps Platform 약관 3.2.3(e)가 NAVER 지도와 Google 지도를 같은 화면에서 전환하는 이 구성에 적용되는지는 확인하지 못했습니다.
- 두 SDK 모두 사용량에 따라 요금이 발생할 수 있습니다.
- HACS를 통한 실제 설치는 아직 검증하지 않았습니다. HACS 대응은 HACS 공식 문서와 소스 코드를 근거로 구성했습니다.

## 개발

```sh
# 테스트
node --test --test-timeout=8000 test/*.test.mjs
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -s test -p '*_test.py'

# 대한민국 경계 다시 만들기 (메모리 상한을 걸고 실행합니다)
OPENBLAS_NUM_THREADS=1 prlimit --as=2500000000 -- .venv/bin/python tools/build_korea_boundary.py

# 설치 패키지(dist/) 다시 만들기
.venv/bin/python tools/build_dist.py
```

- 소스 모듈은 `config/www/`에 있고, `tools/build_dist.py`가 이 파일을 `dist/`로 복사합니다. `dist/`는 HACS가 내려받는 폴더이므로 직접 수정하지 않습니다.
- `config/`에는 격리된 테스트용 HA 컨테이너에 마운트하는 설정도 들어 있습니다.
- SDK 연결 방식과 검증 기록은 [docs/OFFICIAL-SDK.md](docs/OFFICIAL-SDK.md)에 정리했습니다.
- 코드 형식은 Prettier(`.prettierrc.json`)를 따릅니다.

## 데이터 출처

경계 데이터는 geoBoundaries와 Natural Earth 데이터를 가공해 만들었습니다. 북한 데이터(CC BY 3.0 IGO)와 일본 데이터(CC BY 4.0)는 출처를 표기해야 합니다. 표기 문구는 [dist/ATTRIBUTION.md](dist/ATTRIBUTION.md)에 있습니다.
