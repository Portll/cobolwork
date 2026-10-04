* SPDX-License-Identifier: AGPL-3.0-or-later
FIRST    CSECT
         USING FIRST,15
A        DC    C'ABC'
B        DS    H
C        DC    PL3'12',Z'123'
D        DS    0D
E        DC    2F'1,2'
F        EQU   *-E
         LTORG
         ORG   B
G        DC    C'XYZ'
         ORG
H        DC    C'Q'
         ORG   A
I        DC    C'R'
         END
