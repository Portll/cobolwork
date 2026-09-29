* A report queue that leaves the region, and a scratch queue that does not.
 DEFINE TDQUEUE(RPTQ) GROUP(OUT) TYPE(EXTRA) DDNAME(RPTOUT)
 DEFINE TDQUEUE(SCRQ) GROUP(OUT) TYPE(INTRA)
