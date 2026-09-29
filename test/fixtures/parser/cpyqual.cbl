       IDENTIFICATION DIVISION.
       PROGRAM-ID. CPYQUAL.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 REC-A.
          05 FLD PIC X.
       01 REC-B.
          05 FLD PIC X.
       01 TBL.
          05 ENT PIC X OCCURS 3.
       PROCEDURE DIVISION.
       COPY CPYQUAL REPLACING SRC BY FLD IN REC-A
                              DST BY ENT (2).
           DISPLAY REC-B.
           STOP RUN.
