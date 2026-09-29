       IDENTIFICATION DIVISION.
       PROGRAM-ID. QUALUNIQ.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 REC-A.
          05 KEY-ID PIC X.
          05 A-REST PIC X.
       01 REC-B.
          05 KEY-ID PIC X.
       01 MAP-IN.
          05 FIELD-I PIC X.
          05 OTHER-I PIC X.
       01 FLAGS-1.
          05 MODE-1 PIC X.
             88 IS-ON VALUE "Y".
          05 MODE-X PIC X.
       01 FLAGS-2.
          05 MODE-2 PIC X.
             88 IS-ON VALUE "Y".
       01 FLAGS-3.
          05 MODE-3 PIC X.
             88 IS-UP VALUE "Y".
       01 OUT-X PIC X.
       PROCEDURE DIVISION.
           MOVE KEY-ID OF REC-A TO OUT-X
           MOVE FIELD-I OF MAP-IN TO OUT-X
           IF IS-ON IN FLAGS-1 DISPLAY "1" END-IF
           IF IS-UP IN MODE-3 DISPLAY "3" END-IF
           GOBACK.
