* SPDX-License-Identifier: AGPL-3.0-or-later
* CNOP boundary pair fixture
FIRST    CSECT
         USING FIRST,15
L0       DC    C'CNOP0'
         CNOP  0,4
L1       DC    C'CNOP1'
         CNOP  2,4
L2       DC    C'CNOP2'
         CNOP  0,8
L3       DC    C'CNOP3'
         CNOP  2,8
L4       DC    C'CNOP4'
         CNOP  4,8
L5       DC    C'CNOP5'
         CNOP  6,8
L6       DC    C'CNOP6'
L7       DC    C'CNOP7'
L8       DC    C'CNOP8'
L9       DC    C'CNOP9'
LA       DC    C'CNOPA'
LB       DC    C'CNOPB'
LC       DC    C'CNOPC'
LD       DC    C'CNOPD'
LE       DC    C'CNOPE'
LF       DC    C'CNOPF'
LG       DC    C'CNOPG'
LH       DC    C'CNOPH'
LI       DC    C'CNOPI'
LJ       DC    C'CNOPJ'
LK       DC    C'CNOPK'
LL       DC    C'CNOPL'
LM       DC    C'CNOPM'
LN       DC    C'CNOPN'
LO       DC    C'CNOPO'
LP       DC    C'CNOPP'
LQ       DC    C'CNOPQ'
LR       DC    C'CNOPR'
LS       DC    C'CNOPS'
LT       DC    C'CNOPT'
LU       DC    C'CNOPU'
LV       DC    C'CNOPV'
LW       DC    C'CNOPW'
LX       DC    C'CNOPX'
LY       DC    C'CNOPY'
LZ       DC    C'CNOPZ'
         END
