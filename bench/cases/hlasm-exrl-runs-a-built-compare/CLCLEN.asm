CLCLEN   CSECT
         STM   14,12,12(13)
         LR    12,15
         USING CLCLEN,12
         L     2,0(,1)
         LH    3,0(,2)
         BCTR  3,0
         EXRL  3,COMPARE
         LM    14,12,12(13)
         SR    15,15
         BR    14
COMPARE  CLC   KEY(0),2(2)
KEY      DS    CL64
         END
