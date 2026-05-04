package com.gaoze.finaldesign.madsbaked.web.dto;

import java.util.List;

public record GroupedHistoryResponse(
        List<HistoryItemResponse> TODAY,
        List<HistoryItemResponse> LAST_WEEK,
        List<HistoryItemResponse> LAST_MONTH,
        List<HistoryItemResponse> LAST_YEAR,
        List<HistoryItemResponse> OTHERS
) {
}
