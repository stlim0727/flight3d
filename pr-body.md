파타고니아를 번들 DEM/raster surface에서 공통 `OpenWorldRegionSurface` + `OpenWorldTerrain` 타일 경로로 전환합니다.

- `PATAGONIA_ORIGIN`을 공통 지형 frame에 등록
- `RasterRegionSurface` 대신 공통 surface를 사용하도록 preset 로딩 변경
- 번들 DEM/imagery/runway/grading 설정과 startup 대기 코드 제거
- 관련 focused tests, `npm run check`, `npm run build` 통과
