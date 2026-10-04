* SPDX-License-Identifier: AGPL-3.0-or-later
* HLASM fixture: two CSECTs and one DSECT, with the first CSECT resumed after the second, and data defined in each
FIRST    CSECT
         USING FIRST,15
A        DC    C'HELLO'
B        DS    H
C        DC    PL3'12',Z'123'
D        DS    0D
E        DC    2F'1,2'
F        EQU   *-E
         LTORG
SECOND   CSECT
         USING SECOND,15
G        DC    C'WORLD'
H        DS    H
I        DC    PL3'45',Z'456'
J        DS    0D
K        DC    2F'3,4'
L        EQU   *-K
         LTORG
FIRST    CSECT
         USING FIRST,15
M        DC    C'RESUMED'
N        DS    H
O        DC    PL3'78',Z'789'
P        DS    0D
Q        DC    2F'5,6'
R        EQU   *-Q
         LTORG
DATA     DSECT
S        DC    C'DATA'
T        DS    H
U        DC    PL3'99',Z'999'
V        DS    0D
W        DC    2F'7,8'
X        EQU   *-W
         LTORG
         END
